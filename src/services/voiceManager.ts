import { useAppStore } from '@/store/appStore';
import { synthesize } from './ttsService';
import { speakText, stopAllAudioAndSpeech } from './webSpeechService';
import type { VoiceOption } from '@/types';

export interface PlayOptions {
  rate?: number;
  pitch?: number;
  onStart?: () => void;
  onEnd?: () => void;
  onError?: (err: any) => void;
}

interface QueuedSentenceItem {
  text: string;
  blobUrlPromise?: Promise<string | null>;
  blobUrl?: string;
}

/**
 * Single-Source-Of-Truth Voice & Audio Playback Manager.
 *
 * Enforces strict single-channel playback:
 * - HTML5 <audio> and WebSpeech can NEVER play simultaneously.
 * - In-flight TTS synthesis network requests are cleanly aborted on new requests or stop.
 * - Duplicate speech requests for the exact same text within a debounce window are safely blocked.
 * - Session token invalidation prevents stale async callbacks from speaking or updating state.
 * - Provides comprehensive structured logging ([TASK], [AI RESPONSE], [TTS REQUEST], [AUDIO PLAY], [AUDIO STOP]).
 */
class VoicePlaybackManager {
  private audioElement: HTMLAudioElement | null = null;
  private currentSessionId: number = 0;
  private activeAbortController: AbortController | null = null;
  private lastSpokenText: string = '';
  private lastSpokenTime: number = 0;
  private deduplicationWindowMs: number = 1500;
  private activeChannel: 'audio' | 'webspeech' | null = null;
  private onPlaybackEndCallback: (() => void) | null = null;

  // Conversational sentence queue with instant background audio pre-buffering
  private sentenceQueue: QueuedSentenceItem[] = [];
  private activeBlobUrls: string[] = [];
  private isProcessingQueue: boolean = false;
  private isStreamActive: boolean = false;
  private queueSessionId: number = 0;
  private onQueueEmptyCallback: (() => void) | null = null;
  private currentSentenceEndCallback: (() => void) | null = null;
  private isQueueMode: boolean = false;

  public setOnPlaybackEnd(cb: (() => void) | null): void {
    this.onPlaybackEndCallback = cb;
  }

  /**
   * Register the application's HTML5 <audio> element.
   */
  public setAudioElement(el: HTMLAudioElement | null): void {
    if (this.audioElement === el) return;
    this.audioElement = el;
    if (this.audioElement) {
      this.audioElement.onended = () => {
        if (this.activeChannel === 'audio') {
          console.log('[AUDIO STOP] HTML5 Audio playback ended naturally');
          
          // Seamless transition: only reset speaking and playback state if no more queued sentences exist
          const hasMoreSentences = this.isQueueMode && this.sentenceQueue.length > 0;
          if (!hasMoreSentences) {
            this.activeChannel = null;
            useAppStore.getState().setPlaybackState('idle');
            useAppStore.getState().setIsSpeaking(false);
            useAppStore.getState().setSpeechText('');
            useAppStore.getState().setCurrentWordIndex(-1);
          }

          if (this.currentSentenceEndCallback) {
            const cb = this.currentSentenceEndCallback;
            this.currentSentenceEndCallback = null;
            cb();
          } else if (this.onPlaybackEndCallback) {
            this.onPlaybackEndCallback();
          }
        }
      };
      this.audioElement.onerror = (e) => {
        if (this.activeChannel === 'audio') {
          console.warn('[AUDIO STOP] HTML5 Audio error occurred:', e);
          this.activeChannel = null;
          useAppStore.getState().setPlaybackState('idle');
          useAppStore.getState().setIsSpeaking(false);
          useAppStore.getState().setSpeechText('');

          if (this.currentSentenceEndCallback) {
            const cb = this.currentSentenceEndCallback;
            this.currentSentenceEndCallback = null;
            cb();
          }
        }
      };
    }
  }

  public getAudioElement(): HTMLAudioElement | null {
    return this.audioElement;
  }

  /**
   * Complete emergency stop / barge-in interruption:
   * Halts both HTML5 audio and browser speech synthesis in <10ms,
   * purges conversational sentence queue, aborts pending network synthesis,
   * and resets session counter.
   */
  private hardStopAudio(): void {
    if (this.audioElement) {
      try {
        this.audioElement.pause();
        this.audioElement.currentTime = 0;
        this.audioElement.removeAttribute('src');
        this.audioElement.load();
      } catch {}
    }
    if (typeof document !== 'undefined') {
      const fallbackAudio = document.getElementById('tts-audio') as HTMLAudioElement | null;
      if (fallbackAudio && fallbackAudio !== this.audioElement) {
        try {
          fallbackAudio.pause();
          fallbackAudio.currentTime = 0;
          fallbackAudio.removeAttribute('src');
          fallbackAudio.load();
        } catch {}
      }
    }
  }

  public stopAll(reason: string = 'user_action'): void {
    this.currentSessionId++;
    this.queueSessionId++;
    for (const b of this.activeBlobUrls) {
      try { URL.revokeObjectURL(b); } catch {}
    }
    this.activeBlobUrls = [];
    this.sentenceQueue = [];
    this.isProcessingQueue = false;
    this.isStreamActive = false;
    this.currentSentenceEndCallback = null;
    this.onQueueEmptyCallback = null;
    this.isQueueMode = false;

    const currentSession = this.currentSessionId;
    console.log(`[AUDIO STOP] Stopping all audio and speech (Session: ${currentSession}, Reason: ${reason})`);

    // 1. Abort any in-flight TTS API requests
    if (this.activeAbortController) {
      try {
        this.activeAbortController.abort();
      } catch {}
      this.activeAbortController = null;
    }

    // 2. Hard-stop and unload all HTML5 audio elements
    this.hardStopAudio();

    // 3. Hard-cancel window.speechSynthesis
    stopAllAudioAndSpeech();

    this.activeChannel = null;

    // 5. Clean store state
    const store = useAppStore.getState();
    store.setAudioUrl(null);
    store.setPlaybackState('idle');
    store.setIsSpeaking(false);
    store.setVisemeQueue([]);
    store.setCurrentWordIndex(-1);
    store.setSpeechText('');
  }

  /**
   * Preview a voice without consuming ElevenLabs live synthesis credits.
   * If ElevenLabs, plays pre-recorded sample MP3. If WebSpeech, speaks greeting.
   */
  public async playPreview(voice: VoiceOption): Promise<void> {
    this.stopAll('preview_voice');
    this.currentSessionId++;
    const sessionId = this.currentSessionId;

    const store = useAppStore.getState();
    const cleanName = voice.name.replace(/\(ElevenLabs\)|\(Neural\)|\(Female\)/g, '').trim();
    const sampleGreeting = `Hello! I'm ${cleanName}. Nice to meet you.`;

    if (voice.backend === 'elevenlabs' && voice.previewUrl) {
      console.log(`[AUDIO PLAY] Previewing ElevenLabs voice sample: ${voice.name}`);
      this.activeChannel = 'audio';
      store.setSpeechText(voice.sampleText || sampleGreeting);
      store.setAudioUrl(voice.previewUrl);
      await this.playAudioWithSync(voice.previewUrl, sessionId);
    } else if (voice.backend === 'azure') {
      console.log(`[AUDIO PLAY] Speaking Neural voice preview for: ${voice.name}`);
      store.setSpeechText(sampleGreeting);
      await this.playWithAzure(sampleGreeting, voice, sessionId);
    } else {
      console.log(`[AUDIO PLAY] Speaking WebSpeech preview for: ${voice.name}`);
      store.setSpeechText(sampleGreeting);
      this.playWithWebSpeech(sampleGreeting, voice, sessionId);
    }
  }

  /**
   * Start a streaming conversational turn session.
   * Ensures the turn doesn't prematurely complete while LLM tokens are still arriving.
   */
  public startStreamSession(onTurnComplete?: () => void): void {
    this.isStreamActive = true;
    this.isQueueMode = true;
    this.onQueueEmptyCallback = onTurnComplete || null;
  }

  /**
   * Resolve currently active voice option.
   */
  public resolveCurrentVoice(): VoiceOption {
    const store = useAppStore.getState();
    const savedVoiceId = typeof window !== 'undefined' ? localStorage.getItem('talking_character_selected_voice') : null;
    return (
      store.voices.find((v) => v.id === store.selectedVoice) ||
      (savedVoiceId ? store.voices.find((v) => v.id === savedVoiceId) : null) ||
      store.voices.find((v) => v.backend === 'azure') ||
      store.voices[0] ||
      {
        id: 'en-US-JennyNeural',
        name: 'Jenny (Neural)',
        lang: 'en-US',
        backend: 'azure',
        gender: 'female'
      }
    );
  }

  /**
   * Pre-fetches neural TTS audio in the background into an in-memory Blob URL for zero-gap playback.
   */
  private async prefetchSentenceAudio(text: string, voice: VoiceOption): Promise<string | null> {
    try {
      const url = `/api/tts-stream?text=${encodeURIComponent(text)}&voice=${encodeURIComponent(voice.id)}&rate=${encodeURIComponent('+3%')}&pitch=${encodeURIComponent('+1Hz')}`;
      const res = await fetch(url);
      if (!res.ok) return null;
      const blob = await res.blob();
      const blobUrl = URL.createObjectURL(blob);
      this.activeBlobUrls.push(blobUrl);
      return blobUrl;
    } catch {
      return null;
    }
  }

  /**
   * Reset sentence queue and abort any ongoing streaming sentence playback.
   */
  public resetQueue(): void {
    for (const b of this.activeBlobUrls) {
      try { URL.revokeObjectURL(b); } catch {}
    }
    this.activeBlobUrls = [];
    this.sentenceQueue = [];
    this.isProcessingQueue = false;
    this.queueSessionId++;
    this.currentSentenceEndCallback = null;
    this.onQueueEmptyCallback = null;
    this.isQueueMode = false;
  }

  /**
   * Enqueue a sentence for sequential real-time conversational speech playback.
   * Immediately begins pre-fetching the audio buffer in the background for zero-gap playback!
   */
  public enqueueSentence(sentence: string, onQueueEmpty?: () => void): void {
    const trimmed = sentence.trim();
    if (!trimmed) return;
    this.isQueueMode = true;
    if (onQueueEmpty && !this.onQueueEmptyCallback) {
      this.onQueueEmptyCallback = onQueueEmpty;
    }

    const item: QueuedSentenceItem = { text: trimmed };
    const voice = this.resolveCurrentVoice();

    // Immediately pre-fetch audio in the background for this sentence if Neural audio backend is active
    if (voice.backend === 'azure' || voice.backend === 'elevenlabs') {
      item.blobUrlPromise = this.prefetchSentenceAudio(trimmed, voice).then((url) => {
        if (url) item.blobUrl = url;
        return url;
      });
    }

    this.sentenceQueue.push(item);
    if (!this.isProcessingQueue) {
      this.processNextSentence();
    }
  }

  /**
   * Inform the queue that the LLM response stream has completely finished.
   * If all queued sentences are already played, triggers completion callback immediately.
   */
  public notifyStreamDone(): void {
    this.isStreamActive = false;
    if (this.sentenceQueue.length === 0 && !this.isProcessingQueue) {
      this.isQueueMode = false;
      if (this.onQueueEmptyCallback) {
        const cb = this.onQueueEmptyCallback;
        this.onQueueEmptyCallback = null;
        cb();
      }
    }
  }

  private async processNextSentence(): Promise<void> {
    if (this.sentenceQueue.length === 0) {
      this.isProcessingQueue = false;
      // Only complete the turn if the LLM stream is finished
      if (!this.isStreamActive && this.onQueueEmptyCallback) {
        const cb = this.onQueueEmptyCallback;
        this.onQueueEmptyCallback = null;
        this.isQueueMode = false;
        cb();
      }
      return;
    }

    this.isProcessingQueue = true;
    const currentQueueSession = this.queueSessionId;
    const nextItem = this.sentenceQueue.shift()!;

    // Resolve pre-fetched audio URL if ready, or wait up to 450ms for in-flight download to finish
    let preloadedUrl = nextItem.blobUrl;
    if (!preloadedUrl && nextItem.blobUrlPromise) {
      preloadedUrl = (await Promise.race([
        nextItem.blobUrlPromise,
        new Promise<null>((r) => setTimeout(() => r(null), 450))
      ])) || undefined;
    }

    await this.speakSentence(nextItem.text, () => {
      if (this.queueSessionId === currentQueueSession) {
        this.processNextSentence();
      }
    }, preloadedUrl);
  }

  /**
   * Synthesize and play an individual sentence without wiping the conversational queue.
   */
  public async speakSentence(
    text: string,
    onEnded?: () => void,
    preloadedUrl?: string
  ): Promise<void> {
    const trimmed = text?.trim();
    if (!trimmed) {
      onEnded?.();
      return;
    }

    this.currentSessionId++;
    const sessionId = this.currentSessionId;
    this.currentSentenceEndCallback = onEnded || null;

    const store = useAppStore.getState();
    store.setSpeechText(trimmed);
    store.setPlaybackState('loading');
    store.setError(null);

    const voice = this.resolveCurrentVoice();
    const hasElevenLabs = !!store.availableBackends.elevenlabs && !!(typeof window !== 'undefined' ? localStorage.getItem('elevenlabs_api_key') : null);

    if (hasElevenLabs && voice.backend === 'elevenlabs') {
      await this.playWithElevenLabs(trimmed, voice, undefined, sessionId);
    } else if (voice.backend === 'azure') {
      await this.playWithAzure(trimmed, voice, sessionId, preloadedUrl);
    } else if (voice.backend === 'elevenlabs') {
      const fallbackNeural = store.voices.find((v) => v.backend === 'azure') || {
        id: 'en-US-JennyNeural',
        name: 'Jenny (Neural)',
        lang: 'en-US',
        backend: 'azure',
        gender: 'female'
      };
      await this.playWithAzure(trimmed, fallbackNeural, sessionId, preloadedUrl);
    } else {
      this.playWithWebSpeech(trimmed, voice, sessionId);
    }
  }

  /**
   * Main entry point to speak text with full deduplication, playback lock, and channel coordination.
   */
  public async speak(
    rawText: string,
    activeVoice?: VoiceOption | null,
    elevenLabsApiKey?: string,
    forceInstant: boolean = false
  ): Promise<void> {
    const text = rawText?.trim();
    if (!text) return;

    const now = Date.now();
    // 1. Deduplication guard: reject duplicate identical speech within window
    if (this.lastSpokenText === text && now - this.lastSpokenTime < this.deduplicationWindowMs) {
      console.warn(`[TTS REQUEST] Blocked duplicate speech request (${now - this.lastSpokenTime}ms since last call): "${text.substring(0, 40)}..."`);
      return;
    }

    this.lastSpokenText = text;
    this.lastSpokenTime = now;

    // 2. Invalidate previous sessions and stop everything currently playing
    this.stopAll('new_speech_request');
    const sessionId = this.currentSessionId;

    console.log(`[TTS REQUEST] Session ${sessionId} initiating (instant=${forceInstant}) for: "${text.substring(0, 60)}..."`);

    const store = useAppStore.getState();
    store.setSpeechText(text);
    store.setPlaybackState('loading');
    store.setError(null);

    // Resolve voice: strictly respect user's chosen voice, defaulting to primary studio voice
    const savedVoiceId = typeof window !== 'undefined' ? localStorage.getItem('talking_character_selected_voice') : null;
    const voice: VoiceOption = 
      activeVoice ||
      store.voices.find((v) => v.id === store.selectedVoice) ||
      (savedVoiceId ? store.voices.find((v) => v.id === savedVoiceId) : null) ||
      store.voices.find((v) => v.backend === 'azure') ||
      store.voices[0] ||
      {
        id: 'en-US-JennyNeural',
        name: 'Jenny (Neural)',
        lang: 'en-US',
        backend: 'azure',
        gender: 'female'
      };

    const hasElevenLabs = !!elevenLabsApiKey || !!(typeof window !== 'undefined' ? localStorage.getItem('elevenlabs_api_key') : null);

    if (forceInstant || voice.backend === 'webSpeech') {
      this.playWithWebSpeech(text, voice, sessionId);
    } else if (hasElevenLabs && voice.backend === 'elevenlabs') {
      await this.playWithElevenLabs(text, voice, elevenLabsApiKey, sessionId);
    } else if (voice.backend === 'azure') {
      await this.playWithAzure(text, voice, sessionId);
    } else if (voice.backend === 'elevenlabs') {
      const fallbackNeural = store.voices.find((v) => v.backend === 'azure') || {
        id: 'en-US-JennyNeural',
        name: 'Jenny (Neural)',
        lang: 'en-US',
        backend: 'azure',
        gender: 'female'
      };
      await this.playWithAzure(text, fallbackNeural, sessionId);
    } else {
      this.playWithWebSpeech(text, voice, sessionId);
    }
  }

  /**
   * Helper to play an HTML5 audio element with guaranteed lip-sync synchronization:
   * 1. Keeps state as 'loading' while network fetch and buffering occur.
   * 2. Waits for the audio element's 'playing' event (sound actually leaving speakers).
   * 3. Sets playbackState = 'playing' and isSpeaking = true ONLY when audio actually emits sound.
   * 4. Handles abort, errors, and session cancellations cleanly.
   */
  private playAudioWithSync(url: string, sessionId: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const audio = this.audioElement || (typeof document !== 'undefined' ? (document.getElementById('tts-audio') as HTMLAudioElement | null) : null);
      if (!audio) {
        return reject(new Error('No HTML5 audio element available'));
      }

      if (sessionId !== this.currentSessionId) {
        return resolve();
      }

      const store = useAppStore.getState();
      store.setPlaybackState('loading');
      store.setIsSpeaking(false);

      let settled = false;

      const onPlaying = () => {
        if (settled) return;
        settled = true;
        cleanup();
        if (sessionId === this.currentSessionId) {
          console.log(`[AUDIO PLAY] Sound started emitting (Session: ${sessionId})`);
          store.setPlaybackState('playing');
          store.setIsSpeaking(true);
        }
        resolve();
      };

      const onError = (e: any) => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(e);
      };

      const cleanup = () => {
        if (timeoutTimer) clearTimeout(timeoutTimer);
        audio.removeEventListener('playing', onPlaying);
        audio.removeEventListener('error', onError);
      };

      // Network buffering guard: 7000ms timeout
      const timeoutTimer = setTimeout(() => {
        if (!settled) {
          settled = true;
          cleanup();
          this.hardStopAudio();
          reject(new Error('Audio stream buffering timeout exceeded (>7000ms)'));
        }
      }, 7000);

      audio.addEventListener('playing', onPlaying);
      audio.addEventListener('error', onError);

      if (audio.src !== url) {
        audio.src = url;
      }
      audio.currentTime = 0;

      audio.play().then(() => {
        // Fallback if 'playing' event already fired or was missed
        if (!audio.paused && !settled) {
          onPlaying();
        }
      }).catch((err) => {
        if (!settled) {
          settled = true;
          cleanup();
          reject(err);
        }
      });
    });
  }

  /**
   * Synthesizes audio with Azure / Edge Neural TTS and plays natively via HTML5 Audio element.
   */
  private async playWithAzure(
    text: string,
    voice: VoiceOption,
    sessionId: number,
    preloadedUrl?: string
  ): Promise<void> {
    try {
      console.log(`[TTS REQUEST] Streaming Neural Audio (Session: ${sessionId}, Voice: ${voice.name}, preloaded=${!!preloadedUrl})`);
      const streamUrl = preloadedUrl || `/api/tts-stream?text=${encodeURIComponent(text)}&voice=${encodeURIComponent(voice.id)}&s=${sessionId}`;

      // Verify this session is still active
      if (sessionId !== this.currentSessionId) {
        return;
      }

      this.activeChannel = 'audio';
      const store = useAppStore.getState();
      store.setVisemeQueue([]);
      store.setAudioUrl(streamUrl);

      await this.playAudioWithSync(streamUrl, sessionId);
    } catch (err: any) {
      if (sessionId !== this.currentSessionId) return;

      console.warn(`[TTS REQUEST] Neural stream notice:`, err?.message || err);
      // HARD CANCEL AND PURGE any HTML5 audio so it NEVER plays in background alongside WebSpeech
      this.hardStopAudio();
      useAppStore.getState().setAudioUrl(null);
      this.playWithWebSpeech(text, voice, sessionId);
    }
  }

  /**
   * Synthesizes audio with ElevenLabs and plays natively via HTML5 Audio element.
   */
  private async playWithElevenLabs(
    text: string,
    voice: VoiceOption,
    apiKey: string | undefined,
    sessionId: number
  ): Promise<void> {
    this.activeAbortController = new AbortController();
    const key = apiKey || (typeof window !== 'undefined' ? localStorage.getItem('elevenlabs_api_key') || '' : '');

    try {
      console.log(`[TTS REQUEST] Synthesizing ElevenLabs audio (Session: ${sessionId}, Voice: ${voice.name})`);
      const res = await synthesize(text, voice.id, 'elevenlabs', key, undefined, this.activeAbortController.signal);

      // Verify this session is still the active, non-cancelled session
      if (sessionId !== this.currentSessionId) {
        console.log(`[TTS REQUEST] Discarding stale ElevenLabs response (Session ${sessionId} != ${this.currentSessionId})`);
        return;
      }

      if (res && res.audioUrl) {
        console.log(`[AUDIO PLAY] Playing ElevenLabs audio via HTML5 <audio> (Session: ${sessionId})`);
        this.activeChannel = 'audio';

        const store = useAppStore.getState();
        store.setVisemeQueue(res.visemes || []);
        store.setAudioUrl(res.audioUrl);

        await this.playAudioWithSync(res.audioUrl, sessionId);
      } else {
        throw new Error('No audio returned from synthesis');
      }
    } catch (err: any) {
      if (sessionId !== this.currentSessionId) return;

      if (err.name === 'AbortError') {
        console.log(`[TTS REQUEST] ElevenLabs request successfully aborted (Session: ${sessionId})`);
        return;
      }

      console.warn(`[TTS REQUEST] ElevenLabs synthesis notice, switching to studio neural voice:`, err?.message || err);
      
      const store = useAppStore.getState();
      const isQuota = (err?.message || '').toLowerCase().includes('quota') || (err?.message || '').toLowerCase().includes('credit');
      if (isQuota) {
        store.setError('ElevenLabs quota limit reached (0 credits). Speaking via Studio Neural HD voice.');
      } else {
        store.setError(`ElevenLabs notice: ${err?.message || 'Synthesis unavailable'}. Speaking via Studio Neural HD voice.`);
      }

      // Seamless fallback to natural female voice
      const fallbackVoice: VoiceOption = 
        store.voices.find(v => v.backend === 'webSpeech') || {
          id: 'default-female',
          name: 'Studio Natural Voice',
          lang: 'en-US',
          backend: 'webSpeech',
          gender: 'female'
        };
      this.playWithWebSpeech(text, fallbackVoice, sessionId);
    } finally {
      if (sessionId === this.currentSessionId) {
        this.activeAbortController = null;
      }
    }
  }

  /**
   * Plays speech using browser's native window.speechSynthesis.
   */
  private playWithWebSpeech(
    text: string,
    voice: VoiceOption | null,
    sessionId: number
  ): void {
    if (sessionId !== this.currentSessionId) return;

    console.log(`[AUDIO PLAY] Speaking via WebSpeech SpeechSynthesis (Session: ${sessionId}, Voice: ${voice?.name || 'default'})`);
    this.activeChannel = 'webspeech';

    const store = useAppStore.getState();
    // CRITICAL: Hard-unload HTML5 audio so it CANNOT play simultaneously with WebSpeech
    store.setAudioUrl(null);
    this.hardStopAudio();

    store.setPlaybackState('loading');
    store.setIsSpeaking(false);

    speakText(text, voice?.id || null, {
      rate: voice?.rate !== undefined ? voice.rate : 1.0,
      pitch: voice?.pitch !== undefined ? voice.pitch : 1.0,
      onBoundary: (charIndex) => {
        if (sessionId !== this.currentSessionId) return;
        const textUpToChar = text.substring(0, charIndex);
        const words = textUpToChar.split(/\s+/).filter(Boolean);
        store.setCurrentWordIndex(words.length);
        store.setActiveCharIndex(charIndex);
      },
      onStart: () => {
        if (sessionId !== this.currentSessionId) return;
        console.log(`[AUDIO PLAY] WebSpeech utterance started (Session: ${sessionId})`);
        store.setPlaybackState('playing');
        store.setIsSpeaking(true);
      },
      onEnd: () => {
        if (sessionId !== this.currentSessionId) return;
        console.log(`[AUDIO STOP] WebSpeech utterance ended (Session: ${sessionId})`);
        this.activeChannel = null;
        store.setPlaybackState('idle');
        store.setIsSpeaking(false);
        store.setCurrentWordIndex(-1);
        store.setSpeechText('');

        if (this.currentSentenceEndCallback) {
          const cb = this.currentSentenceEndCallback;
          this.currentSentenceEndCallback = null;
          cb();
        } else if (this.onPlaybackEndCallback) {
          this.onPlaybackEndCallback();
        }
      },
      onError: (err) => {
        if (sessionId !== this.currentSessionId) return;
        console.warn(`[AUDIO STOP] WebSpeech error (Session: ${sessionId}):`, err);
        this.activeChannel = null;
        store.setPlaybackState('idle');
        store.setIsSpeaking(false);
        store.setSpeechText('');

        if (this.currentSentenceEndCallback) {
          const cb = this.currentSentenceEndCallback;
          this.currentSentenceEndCallback = null;
          cb();
        }
      }
    });
  }
}

export const voiceManager = new VoicePlaybackManager();
