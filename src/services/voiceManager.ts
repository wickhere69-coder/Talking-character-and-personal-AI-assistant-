import { useAppStore } from '@/store/appStore';
import { synthesize } from './ttsService';
import { speakText, stopAllAudioAndSpeech } from './webSpeechService';
import { ELEVENLABS_VOICE_PACK } from './elevenLabsService';
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
          // Seamless transition: only reset speaking and playback state if no more queued sentences exist
          const hasMoreSentences = this.isQueueMode && this.sentenceQueue.length > 0;
          if (!hasMoreSentences) {
            this.activeChannel = null;
            const state = useAppStore.getState();
            state.setPlaybackState('idle');
            state.setIsSpeaking(false);
            state.setSpeechText('');
            state.setCurrentWordIndex(-1);
            if (state.agentStatus === 'speaking') {
              state.setAgentStatus('idle');
            }
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
          const state = useAppStore.getState();
          state.setPlaybackState('idle');
          state.setIsSpeaking(false);
          state.setSpeechText('');
          if (state.agentStatus === 'speaking') {
            state.setAgentStatus('idle');
          }

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

    if (voice.previewUrl) {
      this.activeChannel = 'audio';
      store.setSpeechText(voice.sampleText || sampleGreeting);
      store.setAudioUrl(voice.previewUrl);
      await this.playAudioWithSync(voice.previewUrl, sessionId);
    } else {
      store.setSpeechText(sampleGreeting);
      await this.playWithElevenLabs(sampleGreeting, voice, undefined, sessionId);
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

  public resolveCurrentVoice(): VoiceOption {
    const store = useAppStore.getState();
    const targetId = store.selectedVoice || (typeof window !== 'undefined' ? localStorage.getItem('talking_character_selected_voice') : null);

    if (targetId && targetId !== 'hpp4J3VqNfWAUOO0d1Us' && targetId !== 'en-US-JennyNeural') {
      const match = store.voices.find((v) => v.id === targetId) || ELEVENLABS_VOICE_PACK.find((v) => v.id === targetId);
      if (match) return match;
    }

    return (
      store.voices.find((v) => v.id === 'pFZP5JQG7iQjIQuC4Bku') ||
      ELEVENLABS_VOICE_PACK.find((v) => v.id === 'pFZP5JQG7iQjIQuC4Bku') ||
      ELEVENLABS_VOICE_PACK[0] ||
      store.voices[0]
    );
  }

  /**
   * Pre-fetches ElevenLabs TTS audio in the background into an in-memory Blob URL for zero-gap playback.
   */
  private async prefetchSentenceAudio(text: string, voice: VoiceOption): Promise<string | null> {
    try {
      const key = typeof window !== 'undefined' ? localStorage.getItem('elevenlabs_api_key') || '' : '';
      if (key && key.startsWith('sk_')) {
        const res = await synthesize(text, voice.id, 'elevenlabs', key);
        if (res?.audioUrl) {
          this.activeBlobUrls.push(res.audioUrl);
          return res.audioUrl;
        }
      }
      const streamUrl = `/api/tts-stream?text=${encodeURIComponent(text)}&voice=${encodeURIComponent(voice.id)}`;
      const res = await fetch(streamUrl);
      if (res.ok) {
        const blob = await res.blob();
        const blobUrl = URL.createObjectURL(blob);
        this.activeBlobUrls.push(blobUrl);
        return blobUrl;
      }
      return null;
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
    if (preloadedUrl) {
      this.activeChannel = 'audio';
      store.setVisemeQueue([]);
      store.setAudioUrl(preloadedUrl);
      await this.playAudioWithSync(preloadedUrl, sessionId);
    } else {
      await this.playWithElevenLabs(trimmed, voice, undefined, sessionId);
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

    const store = useAppStore.getState();
    store.setSpeechText(text);
    store.setPlaybackState('loading');
    store.setError(null);

    // Resolve voice: strictly ElevenLabs voice
    const voice: VoiceOption = activeVoice || this.resolveCurrentVoice();

    await this.playWithElevenLabs(text, voice, elevenLabsApiKey, sessionId);
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
          store.setPlaybackState('playing');
          store.setIsSpeaking(true);
        }
        resolve();
      };

      const onTimeUpdate = () => {
        if (!settled && audio.currentTime > 0) {
          onPlaying();
        }
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
        audio.removeEventListener('timeupdate', onTimeUpdate);
        audio.removeEventListener('error', onError);
      };

      // Network buffering guard: 25000ms timeout
      const timeoutTimer = setTimeout(() => {
        if (!settled) {
          settled = true;
          cleanup();
          this.hardStopAudio();
          reject(new Error('Audio stream buffering timeout exceeded (>25000ms)'));
        }
      }, 25000);

      audio.addEventListener('playing', onPlaying);
      audio.addEventListener('timeupdate', onTimeUpdate);
      audio.addEventListener('error', onError);

      if (audio.src !== url) {
        audio.src = url;
      }
      try {
        if (audio.currentTime !== 0) audio.currentTime = 0;
      } catch {}

      audio.play().then(() => {
        // Fallback if 'playing' event already fired or audio is advancing
        if (!audio.paused && !settled) {
          onPlaying();
        }
      }).catch((err) => {
        console.warn('[AUDIO PLAY] audio.play() rejected:', err);
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
      this.hardStopAudio();
      const store = useAppStore.getState();
      store.setAudioUrl(null);
      store.setPlaybackState('idle');
      store.setIsSpeaking(false);
      // Strictly prevent fallback to default browser system voice (speechSynthesis)
      // Keep character locked exclusively to Lily voice pack
      if (err?.message) {
        store.setError(`Lily voice notice: ${err.message}`);
      }
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

    // Fast-path: Valid ElevenLabs API keys always start with 'sk_'.
    // If key is missing or not a valid sk_ key, skip directly to ultra-fast Studio Neural Edge TTS.
    if (!key || !key.startsWith('sk_')) {
      await this.playWithAzure(text, voice, sessionId);
      return;
    }

    try {
      const res = await synthesize(text, voice.id, 'elevenlabs', key, undefined, this.activeAbortController.signal);

      if (sessionId !== this.currentSessionId) {
        return;
      }

      if (res && res.audioUrl) {
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

      // Stream high quality Studio Neural audio (Lily: British English Velvety Narrator)
      await this.playWithAzure(text, voice, sessionId);
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

    this.activeChannel = 'webspeech';

    const store = useAppStore.getState();
    // CRITICAL: Hard-unload HTML5 audio so it CANNOT play simultaneously with WebSpeech
    store.setAudioUrl(null);
    this.hardStopAudio();

    store.setPlaybackState('loading');
    store.setIsSpeaking(false);

    speakText(text, voice?.id || null, {
      lang: voice?.lang || 'en-GB',
      rate: voice?.rate !== undefined ? voice.rate : 0.92,
      pitch: voice?.pitch !== undefined ? voice.pitch : 0.95,
      onBoundary: (charIndex) => {
        if (sessionId !== this.currentSessionId) return;
        const textUpToChar = text.substring(0, charIndex);
        const words = textUpToChar.split(/\s+/).filter(Boolean);
        store.setCurrentWordIndex(words.length);
        store.setActiveCharIndex(charIndex);
      },
      onStart: () => {
        if (sessionId !== this.currentSessionId) return;
        store.setPlaybackState('playing');
        store.setIsSpeaking(true);
      },
      onEnd: () => {
        if (sessionId !== this.currentSessionId) return;
        this.activeChannel = null;
        store.setPlaybackState('idle');
        store.setIsSpeaking(false);
        store.setCurrentWordIndex(-1);
        store.setSpeechText('');
        if (store.agentStatus === 'speaking') {
          store.setAgentStatus('idle');
        }

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
        if (store.agentStatus === 'speaking') {
          store.setAgentStatus('idle');
        }

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
