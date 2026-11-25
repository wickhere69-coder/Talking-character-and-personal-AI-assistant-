import { useAppStore } from '@/store/appStore';
import { useSessionStore } from '@/store/sessionStore';
import {
  createSpeechRecognizer,
  isSpeechRecognitionSupported,
  type SpeechRecognizerController
} from './webSpeechService';
import { voiceManager } from './voiceManager';
import { pythonBackendService, type BackendEvent } from './pythonBackendService';
import { liveMicService } from './liveMicService';
import { nativeLiveAudioPlayer } from './nativeLiveAudioPlayer';
import { EmotionTracker, type EmotionState } from './emotionDetector';
import { getSpeechCompletionDelay } from '@/utils/speechCompletionDelay';
import { isComplexReasoning, isWebSearchQuery } from '@/utils/reasoningDetector';
import type { AuraConversationState } from '@/types';

const INACTIVITY_TIMEOUT_MS = 60_000;

const GOODBYE_PHRASES = new Set([
  'goodbye', 'bye', 'stop', "that's all", 'go to sleep',
  'never mind', 'nevermind', 'see you later', 'bye bye',
  'sleep', 'mute'
]);

const FAREWELLS = ["See you later!", "Bye for now!", "Talk to you soon!", "Catch you later!"];

// ── Full-duplex / barge-in tuning ────────────────────────────────────────
const FRAME_MS = 40;
const PREROLL_FRAMES = 8;            // 320 ms of audio replayed to the server when a barge-in starts
const BARGE_START_FRAMES = 3;        // 120 ms of clear speech over the echo floor opens the gate
const BARGE_CONFIRM_MS = 650;        // sustained speech this long commits the interruption locally
const BARGE_FALSE_ALARM_FRAMES = 12; // ~480 ms of quiet after a gate opening = cough/noise, resume
const ECHO_TAIL_MS = 220;            // room reverb after Aura stops talking
const ECHO_WARMUP_MS = 450;          // learn this device's echo coupling before allowing barge-in
const MIN_BARGE_RMS = 0.03;
const MAX_BARGE_RMS = 0.25;
const ECHO_MARGIN = 2.5;             // speech must beat the expected echo by this factor
const LOCAL_VAD_RMS = 0.022;         // "user is talking" indicator when the mic is open

const TOOL_LABELS: Record<string, string> = {
  predict_weather: 'Checking the weather…',
  get_weather: 'Checking the weather…',
  web_search: 'Searching the web…',
  fetch_webpage: 'Reading the page…',
  deep_think: 'Thinking it through…',
  remember_about_user: 'Noting that down…',
  recall_about_user: 'Remembering…',
  add_task: 'Adding a task…',
  list_tasks: 'Checking your tasks…',
  complete_task: 'Updating your tasks…',
  add_note: 'Saving a note…',
  list_notes: 'Checking your notes…',
  delete_note: 'Updating your notes…',
};

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function normalizeSpaces(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function cleanTextForSpeech(text: string): string {
  if (!text) return '';
  return text
    .replace(/^\s*[-*•]\s+/gm, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/_([^_]+)_/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/^#+\s+/gm, '')
    .replace(/\n+/g, '. ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

interface LiveTurn {
  id: string;
  sessionId: string;
  assistantMsgId: string;
  userMsgId: string | null;
  lastCaption: string;
  observedChars: number;
  playbackStarted: boolean;
}

class AuraConversationController {
  private activeRecognizer: SpeechRecognizerController | null = null;
  private inactivityTimer: ReturnType<typeof setTimeout> | null = null;
  private silenceTimer: ReturnType<typeof setTimeout> | null = null;
  private cooldownTimer: ReturnType<typeof setTimeout> | null = null;
  private streamAbort: AbortController | null = null;
  private accumulated = '';
  private initialized = false;
  private isProcessingOrSpeaking = false;
  private speechCooldownUntil = 0;
  private lastSpokenAnswer = '';
  private intentionallyStopped = false;
  private activeRequestId: string | null = null;
  private unsubscribers: Array<() => void> = [];
  private liveAccumulatedTranscript = '';
  private queryWatchdogTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingAssistantMsg: { id: string; sessionId: string; content: string; modelUsed?: string } | null = null;

  // ── Live full-duplex state ──
  private liveAvailable = false;       // backend reports Gemini Live is configured
  private liveConversation = false;    // mic is streaming to Gemini Live
  private liveTurn: LiveTurn | null = null;
  private ignoreAudioUntilNextTurn = false;
  private userTurnMsgId: string | null = null;
  private tailUntil = 0;
  private captionTimer: ReturnType<typeof setInterval> | null = null;
  private emotionTimer: ReturnType<typeof setInterval> | null = null;
  private emotion = new EmotionTracker();

  // Echo-aware barge-in gate (only active while Aura's voice is audible)
  private gateOpen = false;
  private gateSpeechFrames = 0;
  private gateQuietFrames = 0;
  private echoRatio = 0.15;      // learned: mic RMS ÷ speaker RMS while only Aura is talking
  private audibleSince = 0;
  private wasAudible = false;
  private preRoll: ArrayBuffer[] = [];
  private bargeConfirmTimer: ReturnType<typeof setTimeout> | null = null;
  private localSpeechFrames = 0;
  private localQuietFrames = 0;

  private get store() {
    return useAppStore.getState();
  }

  private setState(state: AuraConversationState) {
    this.store.setAuraState(state);
  }

  private isNativeVoice(): boolean {
    return this.store.voiceMode !== 'custom_voice_pack';
  }

  private applyEmotion(state: EmotionState | null) {
    if (state) this.store.setCurrentEmotion(state);
  }

  // ════════════════════════════════════════════════════════════════════
  // Lifecycle
  // ════════════════════════════════════════════════════════════════════
  initialize() {
    if (this.initialized) return;
    this.initialized = true;

    const handleAsk = (e: any) => { if (e.detail?.prompt) this.processQuery(e.detail.prompt); };
    const handleToggle = () => this.toggleListening();
    const handleStop = () => this.stopConversation();
    const handleSwitch = (e: any) => {
      this.streamAbort?.abort();
      if (this.activeRequestId) {
        pythonBackendService.cancel(this.activeRequestId);
        this.activeRequestId = null;
      }
      voiceManager.stopAll('session_switch');
      nativeLiveAudioPlayer.stop();
      this.resetLiveTurn();
      this.isProcessingOrSpeaking = false;
      this.store.setIsSpeaking(false);
      this.store.setPlaybackState('idle');
      this.store.setAgentStatus(this.liveConversation ? 'listening' : 'idle');
      this.setState(this.liveConversation ? 'listening' : 'sleeping');
      const targetId = e?.detail?.newSessionId;
      if (targetId) pythonBackendService.switchSession(targetId);
    };
    window.addEventListener('studio-ask-agent', handleAsk);
    window.addEventListener('studio-toggle-mic', handleToggle);
    window.addEventListener('studio-stop-conversation', handleStop);
    window.addEventListener('session-switch', handleSwitch);
    this.unsubscribers.push(() => {
      window.removeEventListener('studio-ask-agent', handleAsk);
      window.removeEventListener('studio-toggle-mic', handleToggle);
      window.removeEventListener('studio-stop-conversation', handleStop);
      window.removeEventListener('session-switch', handleSwitch);
    });

    this.unsubscribers.push(pythonBackendService.onEvent((event) => this.handleBackendEvent(event)));
    this.unsubscribers.push(pythonBackendService.onAudio((pcm) => this.handleLiveAudio(pcm)));

    // Voice mode / Gemini voice are client choices; push them to the backend on change.
    pythonBackendService.setLiveConfig(this.store.voiceMode, this.store.liveVoice);
    this.unsubscribers.push(useAppStore.subscribe((s, prev) => {
      if (s.voiceMode !== prev.voiceMode || s.liveVoice !== prev.liveVoice) {
        pythonBackendService.setLiveConfig(s.voiceMode, s.liveVoice);
      }
    }));

    // Custom-voice-pack live turns arrive as assistant.* text events → ElevenLabs.
    pythonBackendService.setLiveCallbacks({
      onSentence: (sentence: string) => {
        this.clearWatchdog();
        if (!sentence?.trim() || this.isNativeVoice()) return;
        const cleaned = cleanTextForSpeech(sentence);
        if (!cleaned) return;
        if (!this.isProcessingOrSpeaking || this.store.auraState !== 'speaking') {
          this.isProcessingOrSpeaking = true;
          this.setState('speaking');
          this.store.setAgentStatus('speaking');
          this.store.setIsSpeaking(true);
          this.store.setPlaybackState('playing');
        }
        voiceManager.enqueueSentence(cleaned);
      },
      onChunk: (chunk: string) => {
        this.clearWatchdog();
        if (!chunk || this.isNativeVoice()) return;
        this.liveAccumulatedTranscript += (this.liveAccumulatedTranscript ? ' ' : '') + chunk;
        this.store.setSpeechText(this.liveAccumulatedTranscript);
        this.store.setCurrentSentence(chunk);
        this.applyEmotion(this.emotion.observe(chunk, 'assistant'));
        this.upsertMessage(this.liveAssistantMsgIdCustom(), 'assistant', this.liveAccumulatedTranscript, 'gemini-live');
      },
      onDone: (fullResponse: string) => {
        this.clearWatchdog();
        if (this.isNativeVoice()) return;
        voiceManager.notifyStreamDone();
        const finalContent = fullResponse?.trim() || this.liveAccumulatedTranscript.trim();
        this.lastSpokenAnswer = finalContent;
        this.liveAccumulatedTranscript = '';
        this.customLiveMsgId = null;
        this.store.setLastFullResponse(finalContent);
      },
      onCancelled: () => {
        this.clearWatchdog();
        if (!this.isNativeVoice()) this.handleInstantBargeIn('live_cancelled');
      },
      onToolStart: (toolName: string) => this.onToolStarted(toolName),
      onToolEnd: () => this.onToolFinished(),
    });

    // Connect straight to the session the app will restore, so the backend doesn't open a
    // Gemini Live connection for a placeholder session and immediately replace it.
    const savedSessionId = typeof window !== 'undefined'
      ? localStorage.getItem('talking_character_active_session_id')
      : null;
    const initialSessionId = useSessionStore.getState().activeSessionId || savedSessionId || 'session_default_general';
    pythonBackendService.connect(initialSessionId);

    try { voiceManager.getEngine().initialize().catch(() => {}); } catch {}

    // Let emotions relax naturally and follow the energy of Aura's voice.
    this.emotionTimer = setInterval(() => {
      if (nativeLiveAudioPlayer.getIsPlaying()) {
        this.emotion.setEnergy(nativeLiveAudioPlayer.getVisemeFeatures().amp);
      }
      this.applyEmotion(this.emotion.tick());
    }, 250);

    // Dev-only handle for debugging the live pipeline from DevTools.
    if ((import.meta as any).env?.DEV && typeof window !== 'undefined') {
      (window as any).__aura = {
        controller: this,
        appStore: useAppStore,
        sessionStore: useSessionStore,
        player: nativeLiveAudioPlayer,
        backend: pythonBackendService,
      };
    }

    this.setState('sleeping');
    console.log('[Aura] Conversation controller initialized');
  }

  destroy() {
    this.stopActiveRecognizer();
    this.clearTimers();
    this.clearWatchdog();
    this.stopCaptionSync();
    if (this.emotionTimer) { clearInterval(this.emotionTimer); this.emotionTimer = null; }
    this.streamAbort?.abort();
    if (this.activeRequestId) {
      pythonBackendService.cancel(this.activeRequestId);
      this.activeRequestId = null;
    }
    this.unsubscribers.forEach((u) => { try { u(); } catch {} });
    this.unsubscribers = [];
    pythonBackendService.setLiveCallbacks(null);
    liveMicService.stop();
    nativeLiveAudioPlayer.stop();
    pythonBackendService.disconnect();
    voiceManager.stopAll('aura_destroy');
    this.liveConversation = false;
    this.initialized = false;
  }

  private customLiveMsgId: string | null = null;
  private liveAssistantMsgIdCustom(): string {
    if (!this.customLiveMsgId) this.customLiveMsgId = `msg_live_a_${Date.now()}`;
    return this.customLiveMsgId;
  }

  private clearWatchdog() {
    if (this.queryWatchdogTimer) {
      clearTimeout(this.queryWatchdogTimer);
      this.queryWatchdogTimer = null;
    }
  }

  // ════════════════════════════════════════════════════════════════════
  // Public controls
  // ════════════════════════════════════════════════════════════════════
  public isAlwaysOn(): boolean {
    return this.store.isAlwaysOnMic;
  }

  public setAlwaysOnMic(enabled: boolean) {
    this.store.setIsAlwaysOnMic(enabled);
    if (enabled && !this.store.isListening && !this.isProcessingOrSpeaking) {
      this.startListening();
    } else if (!enabled && this.store.isListening) {
      this.stopListening();
    }
  }

  public toggleListening() {
    if (this.liveConversation) {
      this.stopListening();
      return;
    }
    if (this.store.isListening || this.activeRecognizer?.isActive()) {
      const pendingText = (this.accumulated || this.store.scriptText || '').trim();
      if (pendingText && pendingText.length >= 2) {
        this.onUserSpeechComplete(pendingText);
      } else {
        this.stopListening();
      }
    } else if (this.isProcessingOrSpeaking) {
      this.stopConversation();
    } else {
      this.startListening();
    }
  }

  private canUseLive(): boolean {
    return this.liveAvailable && pythonBackendService.isConnected();
  }

  public startListening() {
    if (this.canUseLive()) {
      this.startLiveConversation();
      return;
    }
    // Fallback: browser speech recognition → text turns
    if (!isSpeechRecognitionSupported()) {
      this.store.setError(
        pythonBackendService.isConnected()
          ? 'Live voice is unavailable and this browser has no speech recognition. Try Chrome or Edge.'
          : 'Voice needs the Aura backend running (python_backend on port 8000).'
      );
      return;
    }
    if (this.isProcessingOrSpeaking) this.stopConversation();
    this.speechCooldownUntil = 0;
    this.setState('listening');
    this.store.setAgentStatus('listening');
    this.store.setIsListening(true);
    this.startActiveListening();
  }

  public stopListening() {
    this.clearTimers();
    this.stopActiveRecognizer();
    this.clearTranscript();
    if (this.liveConversation) {
      this.liveConversation = false;
      liveMicService.stop();
      pythonBackendService.sendAudioStreamEnd();
      this.resetGate();
      this.store.setIsUserSpeaking(false);
      this.store.setLiveUserCaption('');
    }
    this.store.setIsListening(false);
    if (!nativeLiveAudioPlayer.getIsPlaying() && !this.isProcessingOrSpeaking) {
      this.store.setAgentStatus('idle');
      this.setState('sleeping');
    }
  }

  public isLiveConversation(): boolean {
    return this.liveConversation;
  }

  /** Stop Aura talking but keep the conversation (mic) open — like tapping to interrupt. */
  public interrupt() {
    if (this.isAssistantAudible() || this.liveTurn || this.isProcessingOrSpeaking) {
      this.handleInstantBargeIn('user_tap');
    }
  }

  public stopConversation() {
    const spoken = this.stopAllPlayback();
    const reqId = this.activeRequestId;
    this.activeRequestId = null;
    if (reqId || this.liveTurn || spoken) {
      pythonBackendService.cancel(reqId || 'live_turn', spoken);
    }
    this.resetLiveTurn();
    this.ignoreAudioUntilNextTurn = true;
    this.isProcessingOrSpeaking = false;
    this.speechCooldownUntil = Date.now() + 400;
    this.clearTranscript();
    this.streamAbort?.abort();
    if (this.liveConversation) {
      this.liveConversation = false;
      liveMicService.stop();
      pythonBackendService.sendAudioStreamEnd();
      this.resetGate();
    }
    this.stopActiveRecognizer();
    this.clearTimers();
    voiceManager.setOnPlaybackEnd(null);
    this.store.setIsListening(false);
    this.store.setIsUserSpeaking(false);
    this.store.setLiveUserCaption('');
    this.store.setAgentStatus('idle');
    this.store.setCurrentAgentAction(null);
    this.setState('sleeping');
    this.applyEmotion(this.emotion.reset());
  }

  public clearTranscript() {
    this.accumulated = '';
    this.activeRecognizer?.clear();
    this.store.setScriptText('');
  }

  public ask(prompt: string) {
    this.clearTranscript();
    this.processQuery(prompt);
  }

  // ════════════════════════════════════════════════════════════════════
  // Live full-duplex conversation (Gemini Live)
  // ════════════════════════════════════════════════════════════════════
  private async startLiveConversation() {
    if (this.liveConversation) return;
    await nativeLiveAudioPlayer.ensureContext();
    liveMicService.setOptions({
      onFrame: (pcm, rms) => this.onMicFrame(pcm, rms),
      onError: (err) => console.warn('[Aura] Mic error:', err),
    });
    try {
      await liveMicService.start();
    } catch (err: any) {
      const denied = err?.name === 'NotAllowedError' || err?.name === 'SecurityError';
      this.store.setError(denied ? 'Microphone access was blocked. Allow the mic to talk with Aura.' : 'Could not start the microphone.');
      setTimeout(() => this.store.setError(null), 4000);
      return;
    }
    this.liveConversation = true;
    this.resetGate();
    pythonBackendService.connectLive();
    this.store.setIsListening(true);
    if (!nativeLiveAudioPlayer.getIsPlaying()) {
      this.setState('listening');
      this.store.setAgentStatus('listening');
    }
    this.resetInactivityTimer();
    console.log('[Aura] Live conversation started (full-duplex, server VAD, echo-aware barge-in)');
  }

  private isAssistantAudible(): boolean {
    return nativeLiveAudioPlayer.getIsPlaying() || voiceManager.getEngine().scheduler.isPlaying();
  }

  /** Every 40 ms mic frame lands here. */
  private onMicFrame(pcm: ArrayBuffer, rms: number) {
    if (!this.liveConversation) return;
    const now = performance.now();
    const audible = this.isAssistantAudible();

    if (!audible && now >= this.tailUntil) {
      // Open mic: stream everything — the server VAD owns turn-taking.
      this.wasAudible = false;
      if (this.gateOpen) {
        this.resetGate();
      } else if (this.preRoll.length) {
        // Frames held during the post-speech echo tail: if the user started talking the
        // instant Aura finished, don't clip their first syllable.
        for (const f of this.preRoll) pythonBackendService.sendAudioChunk(f);
        this.preRoll = [];
      }
      pythonBackendService.sendAudioChunk(pcm);
      this.updateLocalVad(rms);
      return;
    }

    // Aura is talking: only let real speech through (echo-aware gate).
    // Expected echo = learned coupling × what the speakers are playing right now, so the
    // threshold tracks her loudness moment to moment and adapts to each device's AEC.
    if (audible && !this.wasAudible) this.audibleSince = now;
    if (!audible && this.wasAudible) this.preRoll = []; // entering the tail: keep only post-speech frames
    this.wasAudible = audible;
    const speakerRms = nativeLiveAudioPlayer.getIsPlaying() ? nativeLiveAudioPlayer.getPlayingRms() : 0.1;
    this.preRoll.push(pcm);
    if (this.preRoll.length > PREROLL_FRAMES) this.preRoll.shift();

    if (!this.gateOpen && now - this.audibleSince < ECHO_WARMUP_MS) {
      if (speakerRms > 0.01) {
        this.echoRatio = Math.min(1.5, this.echoRatio * 0.75 + (rms / speakerRms) * 0.25);
      }
      return;
    }

    const expectedEcho = this.echoRatio * speakerRms;
    const threshold = Math.min(MAX_BARGE_RMS, Math.max(MIN_BARGE_RMS, expectedEcho * ECHO_MARGIN + 0.01));
    const speechy = rms > threshold;
    if (!speechy && !this.gateOpen && speakerRms > 0.01) {
      this.echoRatio = Math.min(1.5, this.echoRatio * 0.97 + (rms / speakerRms) * 0.03); // keep adapting
    }

    if (this.gateOpen) {
      pythonBackendService.sendAudioChunk(pcm);
      if (speechy) {
        this.gateQuietFrames = 0;
      } else if (++this.gateQuietFrames >= BARGE_FALSE_ALARM_FRAMES && this.bargeConfirmTimer) {
        this.cancelSoftBarge(); // just a cough / bump
      }
      return;
    }

    this.gateSpeechFrames = speechy ? this.gateSpeechFrames + 1 : Math.max(0, this.gateSpeechFrames - 1);
    if (this.gateSpeechFrames >= BARGE_START_FRAMES && audible) {
      this.beginSoftBarge();
    }
  }

  private updateLocalVad(rms: number) {
    if (rms > LOCAL_VAD_RMS) {
      this.localQuietFrames = 0;
      if (++this.localSpeechFrames === 3) {
        this.store.setIsUserSpeaking(true);
        this.resetInactivityTimer();
        if (this.store.agentStatus !== 'speaking') {
          this.setState('listening');
          this.store.setAgentStatus('listening');
        }
      }
    } else {
      this.localSpeechFrames = 0;
      if (++this.localQuietFrames === 10 && this.store.isUserSpeaking) {
        this.store.setIsUserSpeaking(false);
      }
    }
  }

  /** User started talking over Aura: dip her voice immediately and stream their speech. */
  private beginSoftBarge() {
    this.gateOpen = true;
    this.gateQuietFrames = 0;
    for (const f of this.preRoll) pythonBackendService.sendAudioChunk(f);
    this.preRoll = [];
    nativeLiveAudioPlayer.duck(0.22, 50);
    this.store.setIsUserSpeaking(true);
    if (this.bargeConfirmTimer) clearTimeout(this.bargeConfirmTimer);
    this.bargeConfirmTimer = setTimeout(() => {
      this.bargeConfirmTimer = null;
      // Still talking → it's a real interruption even if the server hasn't flagged it
      // (e.g. it already finished generating and is waiting for a new turn).
      if (this.gateOpen && this.gateQuietFrames < 4) this.handleInstantBargeIn('local_vad_sustained');
    }, BARGE_CONFIRM_MS);
    console.log(`[Aura] Soft barge-in (echo coupling ${this.echoRatio.toFixed(2)})`);
  }

  private cancelSoftBarge() {
    if (this.bargeConfirmTimer) { clearTimeout(this.bargeConfirmTimer); this.bargeConfirmTimer = null; }
    this.gateOpen = false;
    this.gateSpeechFrames = 0;
    this.gateQuietFrames = 0;
    nativeLiveAudioPlayer.unduck(200);
    this.store.setIsUserSpeaking(false);
  }

  private resetGate() {
    if (this.bargeConfirmTimer) { clearTimeout(this.bargeConfirmTimer); this.bargeConfirmTimer = null; }
    this.gateOpen = false;
    this.gateSpeechFrames = 0;
    this.gateQuietFrames = 0;
    this.preRoll = [];
  }

  /** 24 kHz PCM from Gemini's native voice. */
  private handleLiveAudio(pcm: ArrayBuffer) {
    if (!this.isNativeVoice() || this.ignoreAudioUntilNextTurn) return;
    if (!this.liveTurn) this.beginLiveTurn('');
    nativeLiveAudioPlayer.queuePcmChunk(pcm);
  }

  private beginLiveTurn(userText: string) {
    this.clearWatchdog();
    this.ignoreAudioUntilNextTurn = false;
    if (this.liveTurn && nativeLiveAudioPlayer.getIsPlaying()) {
      // A new reply began while the previous one was still playing — never overlap voices.
      nativeLiveAudioPlayer.stop(20);
      this.stopCaptionSync();
    }
    const sessionId = useSessionStore.getState().activeSessionId || 'session_default_general';

    // Seal the user's utterance for this turn
    const finalUser = normalizeSpaces(userText || '');
    if (finalUser && this.userTurnMsgId && !this.isEchoOfLastAnswer(finalUser)) {
      this.upsertMessage(this.userTurnMsgId, 'user', finalUser);
    }
    const userMsgId = this.userTurnMsgId;
    this.userTurnMsgId = null;
    this.store.setLiveUserCaption('');
    this.store.setScriptText('');

    const turnId = `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    this.liveTurn = {
      id: turnId,
      sessionId,
      assistantMsgId: `msg_live_a_${turnId}`,
      userMsgId,
      lastCaption: '',
      observedChars: 0,
      playbackStarted: false,
    };
    this.isProcessingOrSpeaking = true;
    nativeLiveAudioPlayer.beginTurn();
    nativeLiveAudioPlayer.setOnPlaybackStart(() => this.onLivePlaybackStart());
    nativeLiveAudioPlayer.setOnPlaybackEnd(() => this.onLiveTurnPlaybackEnd());
    nativeLiveAudioPlayer.setOnIdleMidTurn(() => {
      // e.g. "one sec, let me check" → waiting on a tool: look thoughtful, not frozen mid-word.
      if (!this.liveTurn) return;
      this.store.setIsSpeaking(false);
      this.store.setPlaybackState('loading');
      this.setState('thinking');
      this.store.setAgentStatus('thinking');
    });
    if (!nativeLiveAudioPlayer.getIsPlaying()) {
      this.setState('thinking');
      this.store.setAgentStatus('thinking');
    }
  }

  private onLivePlaybackStart() {
    const turn = this.liveTurn;
    if (!turn) return;
    this.clearWatchdog();
    turn.playbackStarted = true;
    this.isProcessingOrSpeaking = true;
    this.setState('speaking');
    this.store.setAgentStatus('speaking');
    this.store.setIsSpeaking(true);
    this.store.setPlaybackState('playing');
    this.store.setCurrentAgentAction(null);
    this.startCaptionSync();
  }

  /** Reveal text exactly as it is heard; update chat, subtitles and facial emotion. */
  private startCaptionSync() {
    this.stopCaptionSync();
    let lastChatUpdate = 0;
    this.captionTimer = setInterval(() => {
      const turn = this.liveTurn;
      if (!turn) return this.stopCaptionSync();
      const spoken = normalizeSpaces(nativeLiveAudioPlayer.getSpokenText());
      if (spoken === turn.lastCaption) return;
      turn.lastCaption = spoken;
      this.store.setSpeechText(spoken);

      // Emotion follows each newly heard clause
      const fresh = spoken.slice(turn.observedChars);
      if (/[.!?,—]\s*$/.test(fresh) || fresh.length > 48) {
        this.applyEmotion(this.emotion.observe(fresh, 'assistant'));
        this.store.setCurrentSentence(fresh.trim());
        turn.observedChars = spoken.length;
      }

      const now = performance.now();
      if (now - lastChatUpdate > 220) {
        lastChatUpdate = now;
        this.upsertMessage(turn.assistantMsgId, 'assistant', spoken, 'gemini-3.8-live', turn.sessionId);
      }
    }, 90);
  }

  private stopCaptionSync() {
    if (this.captionTimer) { clearInterval(this.captionTimer); this.captionTimer = null; }
  }

  private onLiveTurnPlaybackEnd() {
    const turn = this.liveTurn;
    this.stopCaptionSync();
    if (turn) {
      const full = normalizeSpaces(nativeLiveAudioPlayer.getFullTranscript());
      if (full) {
        this.upsertMessage(turn.assistantMsgId, 'assistant', full, 'gemini-3.8-live', turn.sessionId);
        this.lastSpokenAnswer = full;
        this.store.setLastFullResponse(full);
        const rest = full.slice(turn.observedChars);
        if (rest) this.applyEmotion(this.emotion.observe(rest, 'assistant'));
      }
    }
    this.liveTurn = null;
    this.isProcessingOrSpeaking = false;
    this.tailUntil = performance.now() + ECHO_TAIL_MS;
    this.resetGate();
    this.store.setIsSpeaking(false);
    this.store.setPlaybackState('idle');
    this.store.setCurrentAgentAction(null);
    if (this.liveConversation) {
      this.setState('listening');
      this.store.setAgentStatus('listening');
      this.resetInactivityTimer();
    } else {
      this.setState('sleeping');
      this.store.setAgentStatus('idle');
    }
  }

  private resetLiveTurn() {
    this.stopCaptionSync();
    this.liveTurn = null;
    this.resetGate();
  }

  /** Stop whatever Aura is saying. Returns what the user actually heard. */
  private stopAllPlayback(): string {
    let spoken = '';
    if (nativeLiveAudioPlayer.getIsPlaying() || this.liveTurn) {
      spoken = normalizeSpaces(nativeLiveAudioPlayer.stop());
    }
    if (voiceManager.getEngine().scheduler.isPlaying() || this.store.isSpeaking) {
      spoken = spoken || voiceManager.getCurrentlySpokenText();
      voiceManager.stopAll('barge_in');
    }
    return spoken;
  }

  /**
   * Barge-in: stop Aura mid-word (fast fade), tell the backend what was actually
   * heard, keep the chat honest about it, and flip straight back to listening.
   */
  public handleInstantBargeIn(reason: string = 'user_barge_in') {
    const audible = this.isAssistantAudible();
    if (!audible && !this.isProcessingOrSpeaking && this.store.auraState !== 'speaking') return;
    console.log(`[Aura] Barge-in committed (${reason})`);

    if (this.bargeConfirmTimer) { clearTimeout(this.bargeConfirmTimer); this.bargeConfirmTimer = null; }
    const turn = this.liveTurn;
    const spoken = this.stopAllPlayback();
    this.streamAbort?.abort();
    pythonBackendService.cancel(this.activeRequestId || 'live_turn', spoken);
    this.activeRequestId = null;

    // Chat shows only what was actually said
    if (turn && spoken) {
      this.upsertMessage(turn.assistantMsgId, 'assistant', `${spoken}…`, 'gemini-3.8-live', turn.sessionId);
      this.lastSpokenAnswer = spoken;
    } else if (!turn) {
      const messages = useSessionStore.getState().activeMessages;
      const last = [...messages].reverse().find((m) => m.role === 'assistant');
      const heard = spoken || voiceManager.getCurrentlySpokenText();
      if (last && heard) useSessionStore.getState().appendLocalMessage({ ...last, content: heard.trim() });
    }

    this.stopCaptionSync();
    this.liveTurn = null;
    this.ignoreAudioUntilNextTurn = true; // drop the rest of the cut-off reply
    this.pendingAssistantMsg = null;
    this.isProcessingOrSpeaking = false;
    this.speechCooldownUntil = 0;
    this.tailUntil = 0;
    this.gateOpen = false;
    this.gateSpeechFrames = 0;
    this.clearTranscript();

    // A flicker of "oh—" on the face, then attentive listening
    this.applyEmotion(this.emotion.pulse('surprised', 0.45, 450));
    this.setState('interrupted');
    this.store.setIsSpeaking(false);
    this.store.setPlaybackState('idle');
    this.store.setAgentStatus('listening');
    this.store.setIsListening(this.liveConversation || this.store.isListening);
    setTimeout(() => {
      if (this.store.auraState === 'interrupted') this.setState('listening');
    }, 220);
  }

  /** Safety net while waiting on a live reply: never leave the avatar stuck "thinking". */
  private armLiveWatchdog(ms: number) {
    this.clearWatchdog();
    this.queryWatchdogTimer = setTimeout(() => {
      this.queryWatchdogTimer = null;
      if (this.isAssistantAudible()) return;
      console.warn('[Aura] Live reply watchdog fired — returning to listening');
      this.finishSilentTurn();
    }, ms);
  }

  /** A turn ended (or stalled) without any audio: settle back to a resting state. */
  private finishSilentTurn() {
    this.stopCaptionSync();
    this.liveTurn = null;
    this.isProcessingOrSpeaking = false;
    this.store.setIsSpeaking(false);
    this.store.setPlaybackState('idle');
    this.store.setCurrentAgentAction(null);
    this.setState(this.liveConversation ? 'listening' : 'sleeping');
    this.store.setAgentStatus(this.liveConversation ? 'listening' : 'idle');
  }

  private onToolStarted(toolName: string) {
    // Tools can take a while (deep_think up to ~20 s) — extend, don't drop, the safety net.
    this.armLiveWatchdog(toolName === 'deep_think' ? 30000 : 20000);
    this.store.setCurrentAgentAction(TOOL_LABELS[toolName] || `Using ${toolName.replace(/_/g, ' ')}…`);
    if (toolName === 'deep_think') this.applyEmotion(this.emotion.pulse('thoughtful', 0.7, 2500));
    if (!this.isAssistantAudible()) {
      this.setState('thinking');
      this.store.setAgentStatus('thinking');
    }
  }

  private onToolFinished() {
    this.store.setCurrentAgentAction(null);
  }

  // ════════════════════════════════════════════════════════════════════
  // Backend events
  // ════════════════════════════════════════════════════════════════════
  private handleBackendEvent(event: BackendEvent) {
    switch (event.type) {
      case 'live.ready':
        this.liveAvailable = !!event.has_gemini;
        console.log(`[Aura] Backend ready — live=${this.liveAvailable}, model=${event.model}, voice=${event.voice}, mode=${event.voice_mode}`);
        // Client owns the voice choice; if the server came up with something else, correct it.
        if ((event.voice_mode && event.voice_mode !== this.store.voiceMode) || (event.voice && event.voice !== this.store.liveVoice)) {
          pythonBackendService.setLiveConfig(this.store.voiceMode, this.store.liveVoice, true);
        }
        break;

      case 'live.connected':
        this.liveAvailable = true;
        this.store.setIsGeminiLiveConnected(true);
        break;

      case 'live.reconnecting':
        this.store.setIsGeminiLiveConnected(false);
        break;

      case 'live.error':
        if (event.fatal) {
          this.liveAvailable = false;
          this.store.setIsGeminiLiveConnected(false);
          if (this.liveConversation) {
            this.stopListening();
            this.store.setError('Live voice dropped — switching to standard voice input.');
            setTimeout(() => { this.store.setError(null); this.startListening(); }, 1200);
          }
        }
        break;

      case 'live.turn_started':
        if (this.isNativeVoice()) this.beginLiveTurn(event.user_text || this.store.liveUserCaption);
        break;

      case 'live.transcript':
        if (this.isNativeVoice() && event.text && !this.ignoreAudioUntilNextTurn) {
          if (!this.liveTurn) this.beginLiveTurn('');
          nativeLiveAudioPlayer.markTranscript(event.text);
        }
        break;

      case 'live.user_transcript_interim':
        if (event.text) this.store.setLiveUserCaption(event.text);
        break;

      case 'live.user_transcript': {
        const text = normalizeSpaces(event.full || event.text || '');
        if (!text || this.isEchoOfLastAnswer(text)) break;
        this.store.setLiveUserCaption(text);
        this.store.setScriptText(text);
        this.resetInactivityTimer();
        if (!this.userTurnMsgId) this.userTurnMsgId = `msg_live_u_${Date.now()}`;
        this.upsertMessage(this.userTurnMsgId, 'user', text);
        // Empathic listening: Aura's face reacts to what the user is saying
        this.applyEmotion(this.emotion.observe(text, 'user', 0.8));
        break;
      }

      case 'live.interrupted':
        if (this.isAssistantAudible() || this.liveTurn) {
          this.handleInstantBargeIn('server_interrupted');
        }
        this.ignoreAudioUntilNextTurn = true;
        break;

      case 'live.turn_complete':
        this.clearWatchdog();
        if (this.isNativeVoice()) {
          if (this.ignoreAudioUntilNextTurn) break; // tail of an interrupted turn
          if (!this.liveTurn) {
            // Nothing was said this turn (e.g. the model chose not to respond).
            if (!this.isAssistantAudible() && this.store.agentStatus === 'thinking') this.finishSilentTurn();
            break;
          }
          nativeLiveAudioPlayer.markTurnComplete();
        }
        break;

      case 'tool.started':
        if (!event.request_id) this.onToolStarted(event.tool_name || 'tool');
        break;

      case 'tool.completed':
      case 'tool.cancelled':
        if (!event.request_id) this.onToolFinished();
        break;

      case 'assistant.done':
        this.clearWatchdog();
        if (!this.isNativeVoice() && !event.request_id) voiceManager.notifyStreamDone();
        break;
    }
  }

  private upsertMessage(id: string, role: 'user' | 'assistant', content: string, modelUsed?: string, sessionIdOverride?: string) {
    const sessionStore = useSessionStore.getState();
    const sessionId = sessionIdOverride || sessionStore.activeSessionId || 'session_default_general';
    const existing = sessionStore.activeMessages.find((m) => m.id === id);
    sessionStore.appendLocalMessage({
      id,
      sessionId,
      role,
      content,
      createdAt: existing?.createdAt || Date.now(),
      status: 'delivered',
      ...(modelUsed ? { modelUsed } : {}),
    });
  }

  private isEchoOfText(text: string, reference: string): boolean {
    if (!reference) return false;
    const t = text.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim();
    const r = reference.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim();
    if (t.length < 3 || r.length < 3) return false;
    if (r.includes(t)) return t.split(/\s+/).length >= 3;
    const tWords = t.split(/\s+/).filter((w) => w.length > 2);
    if (tWords.length >= 3) {
      const rWords = new Set(r.split(/\s+/));
      const matches = tWords.filter((w) => rWords.has(w));
      return matches.length / tWords.length > 0.7;
    }
    return false;
  }

  private isEchoOfLastAnswer(text: string): boolean {
    return !!this.lastSpokenAnswer && this.isEchoOfText(text, this.lastSpokenAnswer);
  }

  // ════════════════════════════════════════════════════════════════════
  // Fallback: browser speech recognition (no Gemini Live)
  // ════════════════════════════════════════════════════════════════════
  private startActiveListening() {
    this.stopActiveRecognizer();
    this.accumulated = '';

    this.activeRecognizer = createSpeechRecognizer({
      onTranscript: (transcript: string, isFinal: boolean) => {
        if (this.isProcessingOrSpeaking || Date.now() < this.speechCooldownUntil) {
          const lower = transcript.toLowerCase().trim();
          if (/^(stop|wait|hold on|pause|be quiet|hush|cancel|shut up)\b/i.test(lower)) {
            this.handleInstantBargeIn('speech_command');
          }
          return;
        }
        const trimmed = transcript.trim();
        if (!trimmed || this.isEchoOfLastAnswer(trimmed)) return;

        this.accumulated = trimmed;
        this.store.setScriptText(trimmed);
        this.applyEmotion(this.emotion.observe(trimmed, 'user', 0.6));
        this.resetInactivityTimer();
        if (this.silenceTimer) clearTimeout(this.silenceTimer);
        this.setState('listening');
        this.store.setAgentStatus('listening');

        const isRepeat = this.store.agentModeType === 'repeat';
        const delay = getSpeechCompletionDelay(this.accumulated, isFinal, isRepeat ? 'repeat' : 'agent');
        this.silenceTimer = setTimeout(() => {
          const toProcess = this.accumulated.trim();
          if (toProcess.length >= 2) this.onUserSpeechComplete(toProcess);
        }, delay);
      },
      onEnd: () => {
        if (this.intentionallyStopped) return;
        if (this.silenceTimer && this.accumulated.trim().length >= 2) return;
        this.store.setIsListening(false);
        if (this.store.isAlwaysOnMic && !this.isProcessingOrSpeaking && Date.now() >= this.speechCooldownUntil) {
          setTimeout(() => {
            if (this.store.isAlwaysOnMic && !this.isProcessingOrSpeaking) this.startActiveListening();
          }, 200);
        } else if (!this.isProcessingOrSpeaking) {
          this.setState('sleeping');
          this.store.setAgentStatus('idle');
        }
      },
      onError: (err) => console.warn('[Aura] Speech recognition notice:', err),
    });

    if (this.activeRecognizer) {
      try {
        this.activeRecognizer.start();
        this.store.setIsListening(true);
        this.resetInactivityTimer();
      } catch (e) {
        console.warn('[Aura] Recognizer start failed:', e);
      }
    }
  }

  private onUserSpeechComplete(text: string) {
    if (this.isProcessingOrSpeaking || Date.now() < this.speechCooldownUntil) return;
    const trimmed = text.trim();
    if (trimmed.length < 2) {
      if (this.store.isAlwaysOnMic) this.startActiveListening();
      return;
    }
    this.activeRecognizer?.pause();
    this.activeRecognizer?.clear();
    this.clearTimers();
    this.store.setIsListening(false);
    this.accumulated = '';
    this.store.setScriptText('');

    const lower = trimmed.toLowerCase();
    if (GOODBYE_PHRASES.has(lower) || Array.from(GOODBYE_PHRASES).some((p) => lower.includes(p))) {
      this.returnToSleep('user_goodbye');
      return;
    }
    this.processQuery(trimmed);
  }

  // ════════════════════════════════════════════════════════════════════
  // Typed (and fallback-spoken) turns
  // ════════════════════════════════════════════════════════════════════
  public async processQuery(text: string) {
    const trimmed = text.trim();
    if (!trimmed) return;

    // Typing while Aura talks interrupts her, just like speaking would.
    if (this.isAssistantAudible()) this.handleInstantBargeIn('typed_message');

    this.streamAbort?.abort();
    this.streamAbort = new AbortController();
    const abortSignal = this.streamAbort.signal;
    this.isProcessingOrSpeaking = true;
    this.clearTimers();
    this.activeRecognizer?.pause();
    this.activeRecognizer?.clear();
    this.accumulated = '';
    this.store.setScriptText('');
    if (!this.liveConversation) this.store.setIsListening(false);

    const nativeLive = this.isNativeVoice() && this.canUseLive();
    const isReasoning = isComplexReasoning(trimmed);
    const isWebSearch = isWebSearchQuery(trimmed);
    const providerToSend = 'langgraph';
    this.store.setAgentModelName(nativeLive ? 'Gemini Live' : 'Deep Think');
    this.store.setAgentSpeed('langgraph');
    voiceManager.setOnPlaybackEnd(null);

    const sessionStore = useSessionStore.getState();
    const currentSessionId = sessionStore.activeSessionId || 'session_default_general';
    if (!sessionStore.activeSessionId) sessionStore.selectSession(currentSessionId);

    sessionStore.appendLocalMessage({
      id: `msg_u_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      sessionId: currentSessionId,
      role: 'user',
      content: trimmed,
      createdAt: Date.now(),
      status: 'delivered'
    });

    this.setState('thinking');
    this.store.setAgentStatus('thinking');
    this.store.setPlaybackState('loading');
    this.store.setError(null);
    this.applyEmotion(this.emotion.observe(trimmed, 'user', 0.8));
    // In native live mode the real tool events set accurate labels.
    this.store.setCurrentAgentAction(!nativeLive && isWebSearch ? 'Searching the web…' : null);

    // Gemini Live answers in ~0.6 s with its own voice — a filler would just collide.
    if (!nativeLive && (isWebSearch || isReasoning || trimmed.length > 25)) {
      try {
        const category = isWebSearch ? 'search' : (isReasoning ? 'thinking' : 'general');
        const fillerResult = voiceManager.getEngine().filler.triggerInstantFiller(category);
        if (fillerResult.played && fillerResult.text) {
          this.store.setCurrentAgentAction(fillerResult.text);
        }
      } catch {}
    }
    this.store.setSpeechText('');
    this.store.setCurrentSentence('');

    const assistantMsgId = `msg_a_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    let accumulatedText = '';
    let hasStartedSpeaking = false;

    this.clearWatchdog();
    this.queryWatchdogTimer = setTimeout(() => {
      if (this.isProcessingOrSpeaking && this.store.agentStatus === 'thinking') {
        console.warn('[Aura] Watchdog: no response within 20s. Resetting state.');
        if (this.activeRequestId) {
          pythonBackendService.cancel(this.activeRequestId);
          this.activeRequestId = null;
        }
        voiceManager.stopAll('watchdog_timeout');
        nativeLiveAudioPlayer.stop();
        this.resetLiveTurn();
        this.isProcessingOrSpeaking = false;
        this.store.setAgentStatus(this.liveConversation ? 'listening' : 'idle');
        this.store.setPlaybackState('idle');
        this.setState(this.liveConversation ? 'listening' : 'sleeping');
        this.store.setCurrentAgentAction(null);
        this.store.setError('That took too long — mind asking again?');
        setTimeout(() => this.store.setError(null), 3500);
      }
    }, 20000);

    let spokenSoFar = '';
    voiceManager.startStreamSession(
      () => this.onResponseComplete(),
      (sentenceText: string) => {
        if (!hasStartedSpeaking) {
          hasStartedSpeaking = true;
          this.setState('speaking');
          this.store.setAgentStatus('speaking');
        }
        spokenSoFar += (spokenSoFar ? ' ' : '') + sentenceText;
        this.lastSpokenAnswer = spokenSoFar;
        this.applyEmotion(this.emotion.observe(sentenceText, 'assistant'));
        useSessionStore.getState().appendLocalMessage({
          id: assistantMsgId,
          sessionId: currentSessionId,
          role: 'assistant',
          content: spokenSoFar,
          createdAt: Date.now(),
          status: 'delivered',
          modelUsed: providerToSend
        });
      }
    );

    if (this.activeRequestId) {
      pythonBackendService.cancel(this.activeRequestId);
      this.activeRequestId = null;
    }

    const fail = (err: any) => {
      this.clearWatchdog();
      if (abortSignal.aborted) return;
      this.activeRequestId = null;
      console.error('[Aura] Conversation error:', err);
      voiceManager.stopAll('stream_error');
      nativeLiveAudioPlayer.stop();
      this.isProcessingOrSpeaking = false;
      this.store.setAgentStatus('error');
      this.store.setError(err?.message || 'Query failed');
      setTimeout(() => {
        this.store.setAgentStatus(this.liveConversation ? 'listening' : 'idle');
        this.setState(this.liveConversation ? 'listening' : 'sleeping');
      }, 2000);
    };

    try {
      this.activeRequestId = pythonBackendService.sendMessage(
        trimmed,
        currentSessionId,
        { mode: this.store.agentModeType, modelProvider: providerToSend, use_live: true, maxTokens: 2048 },
        {
          onLiveAccepted: () => {
            // Native Gemini voice will answer; the live pipeline takes it from here.
            this.activeRequestId = null;
            voiceManager.resetQueue();
            this.ignoreAudioUntilNextTurn = false;
            this.armLiveWatchdog(15000);
          },
          onSentence: (sentence: string) => {
            this.clearWatchdog();
            if (abortSignal.aborted) return;
            const cleaned = cleanTextForSpeech(sentence);
            if (cleaned) voiceManager.enqueueSentence(cleaned);
          },
          onChunk: (chunk: string) => {
            this.clearWatchdog();
            if (abortSignal.aborted) return;
            accumulatedText += (accumulatedText ? ' ' : '') + chunk;
          },
          onDone: (fullResponse: string, modelUsed: string, respSessionId?: string) => {
            this.clearWatchdog();
            if (abortSignal.aborted) return;
            this.activeRequestId = null;
            voiceManager.notifyStreamDone();
            const finalContent = fullResponse?.trim() || accumulatedText.trim();
            this.pendingAssistantMsg = {
              id: assistantMsgId,
              sessionId: respSessionId || currentSessionId,
              content: finalContent,
              modelUsed,
            };
            this.lastSpokenAnswer = cleanTextForSpeech(finalContent);
            this.store.setLastFullResponse(finalContent);
            this.store.setAgentModelName(modelUsed?.includes('live') ? 'Gemini Live' : 'Deep Think');
          },
          onError: fail,
          onToolStart: (toolName: string) => {
            if (!abortSignal.aborted) this.onToolStarted(toolName);
          },
          onToolEnd: () => {
            if (!abortSignal.aborted) this.onToolFinished();
          },
        }
      );
    } catch (err: any) {
      fail(err);
    }
  }

  private onResponseComplete() {
    this.isProcessingOrSpeaking = false;
    this.store.setIsSpeaking(false);
    this.store.setPlaybackState('idle');

    if (this.pendingAssistantMsg?.content) {
      useSessionStore.getState().appendLocalMessage({
        id: this.pendingAssistantMsg.id,
        sessionId: this.pendingAssistantMsg.sessionId,
        role: 'assistant',
        content: this.pendingAssistantMsg.content,
        createdAt: Date.now(),
        status: 'delivered',
        modelUsed: this.pendingAssistantMsg.modelUsed
      });
      this.pendingAssistantMsg = null;
    }

    if (this.liveConversation) {
      // Full-duplex: the mic never closed; just let the room echo settle.
      this.tailUntil = performance.now() + ECHO_TAIL_MS;
      this.setState('listening');
      this.store.setAgentStatus('listening');
      return;
    }

    this.store.setAgentStatus('idle');
    // Browser speech recognition has no echo cancellation of its own — short cooldown.
    this.speechCooldownUntil = Date.now() + 600;
    this.clearTranscript();
    if (this.cooldownTimer) clearTimeout(this.cooldownTimer);
    this.cooldownTimer = setTimeout(() => {
      if (this.store.isAlwaysOnMic && !this.isProcessingOrSpeaking) {
        this.startActiveListening();
      } else {
        this.stopActiveRecognizer();
        this.setState('sleeping');
        this.store.setIsListening(false);
      }
    }, 600);
  }

  private returnToSleep(reason: string) {
    this.stopActiveRecognizer();
    this.clearTimers();
    this.store.setIsListening(false);

    if (reason === 'user_goodbye') {
      const farewell = pick(FAREWELLS);
      this.setState('stopping');
      this.store.setAgentStatus('speaking');
      voiceManager.setOnPlaybackEnd(() => {
        voiceManager.setOnPlaybackEnd(null);
        this.setState('sleeping');
        this.store.setAgentStatus('idle');
      });
      const voice = voiceManager.resolveCurrentVoice();
      voiceManager.speak(farewell, voice);
    } else {
      if (this.liveConversation) this.stopListening();
      this.setState('sleeping');
      this.store.setAgentStatus('idle');
    }
  }

  private stopActiveRecognizer() {
    this.intentionallyStopped = true;
    if (this.activeRecognizer) {
      try { this.activeRecognizer.abort(); } catch {}
      this.activeRecognizer = null;
    }
    setTimeout(() => { this.intentionallyStopped = false; }, 100);
  }

  private clearTimers() {
    if (this.inactivityTimer) { clearTimeout(this.inactivityTimer); this.inactivityTimer = null; }
    if (this.silenceTimer) { clearTimeout(this.silenceTimer); this.silenceTimer = null; }
    if (this.cooldownTimer) { clearTimeout(this.cooldownTimer); this.cooldownTimer = null; }
  }

  private resetInactivityTimer() {
    if (this.inactivityTimer) clearTimeout(this.inactivityTimer);
    // A live conversation stays open until the user ends it (like a call).
    if (this.liveConversation) return;
    this.inactivityTimer = setTimeout(() => {
      if (this.store.isListening && !this.store.isAlwaysOnMic) {
        this.returnToSleep('inactivity');
      }
    }, INACTIVITY_TIMEOUT_MS);
  }
}

export const auraController = new AuraConversationController();
