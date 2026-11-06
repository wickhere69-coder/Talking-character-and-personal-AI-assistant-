import { useAppStore } from '@/store/appStore';
import { useSessionStore } from '@/store/sessionStore';
import {
  createSpeechRecognizer,
  isSpeechRecognitionSupported,
  type SpeechRecognizerController
} from './webSpeechService';
import { voiceManager } from './voiceManager';
import { sendAgentMessage, streamAgentConversation } from './agentService';
import { pythonBackendService } from './pythonBackendService';
import { detectEmotion } from './emotionDetector';
import { getSpeechCompletionDelay } from '@/utils/speechCompletionDelay';
import { isComplexReasoning, isWebSearchQuery } from '@/utils/reasoningDetector';
import type { AuraConversationState } from '@/types';

const INACTIVITY_TIMEOUT_MS = 60_000;

const GOODBYE_PHRASES = new Set([
  'goodbye', 'bye', 'stop', "that's all", 'go to sleep',
  'never mind', 'nevermind', 'see you later', 'bye bye',
  'sleep', 'mute'
]);

const FAREWELLS = [
  "See you later!",
  "Bye for now!",
  "Talk to you soon!",
  "Catch you later!"
];

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
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
  private pendingAssistantMsg: {
    id: string;
    sessionId: string;
    content: string;
    modelUsed?: string;
  } | null = null;

  private get store() {
    return useAppStore.getState();
  }

  private setState(state: AuraConversationState) {
    this.store.setAuraState(state);
  }

  initialize() {
    if (this.initialized) return;
    this.initialized = true;

    // Listen to global events for conversation
    const handleAsk = (e: any) => {
      if (e.detail?.prompt) {
        this.processQuery(e.detail.prompt);
      }
    };
    const handleToggle = () => {
      this.toggleListening();
    };
    const handleStop = () => {
      this.stopConversation();
    };

    window.addEventListener('studio-ask-agent', handleAsk);
    window.addEventListener('studio-toggle-mic', handleToggle);
    window.addEventListener('studio-stop-conversation', handleStop);
    window.addEventListener('session-switch', (e: any) => {
      this.streamAbort?.abort();
      if (this.activeRequestId) {
        pythonBackendService.cancel(this.activeRequestId);
        this.activeRequestId = null;
      }
      voiceManager.stopAll('session_switch');
      this.isProcessingOrSpeaking = false;
      this.store.setIsSpeaking(false);
      this.store.setPlaybackState('idle');
      this.store.setAgentStatus('idle');
      this.setState('sleeping');

      const targetId = e?.detail?.newSessionId;
      if (targetId) {
        pythonBackendService.connect(targetId);
      }
    });

    // Pre-warm Python backend connection for active session
    const initialSessionId = useSessionStore.getState().activeSessionId || 'session_default_general';
    pythonBackendService.connect(initialSessionId);

    // If Always-On Mic was previously enabled, auto-start on first user interaction
    if (this.store.isAlwaysOnMic) {
      console.log('[Aura] Always-On Mic enabled in settings');
    }

    this.setState('sleeping');
    console.log('[Aura] Conversation controller initialized');
  }

  destroy() {
    this.stopActiveRecognizer();
    this.clearTimers();
    this.streamAbort?.abort();
    if (this.activeRequestId) {
      pythonBackendService.cancel(this.activeRequestId);
      this.activeRequestId = null;
    }
    pythonBackendService.disconnect();
    voiceManager.stopAll('aura_destroy');
    this.initialized = false;
  }

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
    if (this.store.isListening || this.activeRecognizer?.isActive()) {
      const pendingText = (this.accumulated || this.store.scriptText || '').trim();
      if (pendingText && pendingText.length >= 2) {
        // User tapped the mic button while speech was transcribed: submit question immediately!
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

  public startListening() {
    if (!isSpeechRecognitionSupported()) {
      console.warn('[Aura] Speech recognition not supported in this browser');
      this.store.setError('Microphone speech recognition requires Google Chrome, Edge, or Brave browser.');
      return;
    }

    if (this.isProcessingOrSpeaking) {
      this.stopConversation();
    }

    this.speechCooldownUntil = 0;
    this.setState('listening');
    this.store.setAgentStatus('listening');
    this.store.setIsListening(true);
    this.startActiveListening();
  }

  public stopListening() {
    this.clearTimers();
    this.stopActiveRecognizer();
    this.store.setIsListening(false);
    this.store.setAgentStatus('idle');
    this.setState('sleeping');
  }

  public stopConversation() {
    this.isProcessingOrSpeaking = false;
    this.speechCooldownUntil = Date.now() + 400;
    voiceManager.stopAll('user_stop');
    this.streamAbort?.abort();
    if (this.activeRequestId) {
      pythonBackendService.cancel(this.activeRequestId);
      this.activeRequestId = null;
    }
    this.stopActiveRecognizer();
    this.clearTimers();
    voiceManager.setOnPlaybackEnd(null);
    this.store.setIsListening(false);
    this.store.setAgentStatus('idle');
    this.setState('sleeping');
  }

  public ask(prompt: string) {
    this.processQuery(prompt);
  }

  private isEchoOfText(text: string, reference: string): boolean {
    if (!reference) return false;
    const t = text.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim();
    const r = reference.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim();
    if (t.length < 3 || r.length < 3) return false;
    if (r.includes(t) || t.includes(r)) return true;

    // Check word overlap: if >35% of significant words match reference, it is acoustic bleed
    const tWords = t.split(/\s+/).filter(w => w.length > 2);
    if (tWords.length >= 2) {
      const matches = tWords.filter(w => r.includes(w));
      if (matches.length / tWords.length > 0.35) {
        return true;
      }
    }
    return false;
  }

  private isEchoOfLastAnswer(text: string): boolean {
    if (this.lastSpokenAnswer && this.isEchoOfText(text, this.lastSpokenAnswer)) {
      return true;
    }
    const messages = useSessionStore.getState().activeMessages;
    const lastAssistantMsg = [...messages].reverse().find(m => m.role === 'assistant');
    if (lastAssistantMsg?.content && this.isEchoOfText(text, lastAssistantMsg.content)) {
      return true;
    }
    return false;
  }

  /**
   * Real-Time Voice Barge-In:
   * Instantly halts ongoing audio, cancels backend LLM generation,
   * emits polite spoken chirp ("Oh, go ahead!"), and switches to active listening.
   */
  private interruptCurrentSpeech(currentlySpoken: string) {
    this.isProcessingOrSpeaking = false;
    this.speechCooldownUntil = 0;
    voiceManager.stopAll('user_barge_in');
    this.streamAbort?.abort();

    if (this.activeRequestId) {
      pythonBackendService.cancel(this.activeRequestId, currentlySpoken);
      this.activeRequestId = null;
    }

    // Play instant polite chirp
    voiceManager.playChirp("Oh, go ahead!");

    this.setState('listening');
    this.store.setAgentStatus('listening');
    this.store.setIsListening(true);
  }

  private startActiveListening() {
    this.stopActiveRecognizer();
    this.accumulated = '';

    this.activeRecognizer = createSpeechRecognizer({
      onTranscript: (transcript: string, isFinal: boolean) => {
        // 1. ABSOLUTE CHAT LOOP PREVENTION:
        // If Aura is speaking, processing, or in post-speech cooldown, NEVER submit speech to the conversation!
        if (this.isProcessingOrSpeaking || Date.now() < this.speechCooldownUntil) {
          // Check for explicit stop / interruption keywords only
          const lower = transcript.toLowerCase().trim();
          const isStopCmd = /^(stop|wait|hold on|pause|be quiet|hush|cancel|shut up)\b/i.test(lower);
          if (isStopCmd) {
            console.log('[Aura] Explicit user interruption command detected:', lower);
            const currentlySpoken = voiceManager.getCurrentlySpokenText();
            this.interruptCurrentSpeech(currentlySpoken);
          }
          // In all cases while speaking, discard this transcript to prevent feedback loops!
          return;
        }

        const trimmed = transcript.trim();
        if (!trimmed) return;

        // Discard acoustic self-echo from recently completed speech
        if (this.isEchoOfLastAnswer(trimmed)) {
          console.log('[Aura] Echo filtered:', trimmed);
          return;
        }

        this.accumulated = trimmed;
        // Display real-time transcript right in the search bar!
        this.store.setScriptText(trimmed);
        this.resetInactivityTimer();

        if (this.silenceTimer) clearTimeout(this.silenceTimer);

        this.setState('listening');
        this.store.setAgentStatus('listening');

        // Dynamic pause delay based on speech length
        const isRepeat = this.store.agentModeType === 'repeat';
        const delay = getSpeechCompletionDelay(this.accumulated, isFinal, isRepeat ? 'repeat' : 'agent');

        this.silenceTimer = setTimeout(() => {
          const toProcess = this.accumulated.trim();
          if (toProcess && toProcess.length >= 2) {
            this.onUserSpeechComplete(toProcess);
          }
        }, delay);
      },
      onEnd: () => {
        if (this.intentionallyStopped) return;

        // If a silenceTimer is currently waiting for end-of-speech pause, let it finish so the user isn't prematurely cut off
        if (this.silenceTimer && this.accumulated.trim().length >= 2) {
          return;
        }

        this.store.setIsListening(false);

        // In Always-On mode, cleanly restart listening if idle
        if (this.store.isAlwaysOnMic && !this.isProcessingOrSpeaking && Date.now() >= this.speechCooldownUntil) {
          setTimeout(() => {
            if (this.store.isAlwaysOnMic && !this.isProcessingOrSpeaking) {
              this.startActiveListening();
            }
          }, 200);
        } else if (!this.isProcessingOrSpeaking) {
          this.setState('sleeping');
          this.store.setAgentStatus('idle');
        }
      },
      onError: (err) => {
        console.warn('[Aura] Speech recognition notice:', err);
      }
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
    if (!trimmed || trimmed.length < 2) {
      if (this.store.isAlwaysOnMic) {
        this.startActiveListening();
      }
      return;
    }

    // Immediately pause recognizer while processing query to prevent feedback
    this.activeRecognizer?.pause();
    this.activeRecognizer?.clear();
    this.clearTimers();
    this.store.setIsListening(false);
    this.accumulated = '';
    this.store.setScriptText('');

    const lower = trimmed.toLowerCase();
    const isGoodbye = GOODBYE_PHRASES.has(lower) ||
      Array.from(GOODBYE_PHRASES).some(p => lower.includes(p));

    if (isGoodbye) {
      this.returnToSleep('user_goodbye');
      return;
    }

    this.processQuery(trimmed);
  }

  public async processQuery(text: string) {
    const trimmed = text.trim();
    if (!trimmed) return;

    this.streamAbort?.abort();
    this.streamAbort = new AbortController();
    const abortSignal = this.streamAbort.signal;
    this.isProcessingOrSpeaking = true;
    this.clearTimers();
    this.activeRecognizer?.pause();
    this.activeRecognizer?.clear();
    this.accumulated = '';
    this.store.setIsListening(false);

    // Deep Think mode is always active for high quality, with fast 1-2s response for conversation
    const isReasoning = isComplexReasoning(trimmed);
    const isWebSearch = isWebSearchQuery(trimmed);
    const providerToSend = 'langgraph';

    this.store.setAgentModelName('Deep Think');
    this.store.setAgentSpeed('langgraph');

    voiceManager.setOnPlaybackEnd(null);

    const sessionStore = useSessionStore.getState();
    const currentSessionId = sessionStore.activeSessionId;

    // 1. Append user message immediately to the active session
    if (currentSessionId) {
      sessionStore.appendLocalMessage({
        id: `msg_u_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
        sessionId: currentSessionId,
        role: 'user',
        content: trimmed,
        createdAt: Date.now(),
        status: 'delivered'
      });
    }

    // 2. Set state to thinking - DO NOT show subtitle text yet
    this.setState('thinking');
    this.store.setAgentStatus('thinking');
    this.store.setPlaybackState('loading');
    this.store.setError(null);
    this.store.setCurrentEmotion(detectEmotion(trimmed));
    this.store.setCurrentAgentAction(
      isWebSearch
        ? 'Deep Think: Searching web & analyzing...'
        : 'Deep Think: Formulating response...'
    );
    this.store.setSpeechText('');
    this.store.setCurrentSentence('');

    const assistantMsgId = `msg_a_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    let accumulatedText = '';
    let hasStartedSpeaking = false;

    // Safety watchdog: Recover state if no backend response is received within 15 seconds
    let watchdogTimer: any = setTimeout(() => {
      if (this.isProcessingOrSpeaking && this.store.agentStatus === 'thinking') {
        console.warn('[Aura] Watchdog: No response received within 15s. Resetting state.');
        if (this.activeRequestId) {
          pythonBackendService.cancel(this.activeRequestId);
          this.activeRequestId = null;
        }
        voiceManager.stopAll('watchdog_timeout');
        this.isProcessingOrSpeaking = false;
        this.store.setAgentStatus('idle');
        this.store.setPlaybackState('idle');
        this.setState('sleeping');
        this.store.setCurrentAgentAction(null);
        this.store.setError('I took too long to get an answer. Please try asking again.');
        setTimeout(() => this.store.setError(null), 3500);
      }
    }, 15000);

    const clearWatchdog = () => {
      if (watchdogTimer) {
        clearTimeout(watchdogTimer);
        watchdogTimer = null;
      }
    };

    // 3. Start streaming sentence queue in voiceManager
    // Pass onSentenceStart callback: Audio sound has literally started coming out of the speakers!
    let spokenSoFar = '';
    voiceManager.startStreamSession(
      () => {
        this.onResponseComplete();
      },
      (sentenceText: string) => {
        // EXACT AUDIO-TEXT SYNCHRONIZATION:
        // Text is illuminated at the exact millisecond speech begins playing!
        if (!hasStartedSpeaking) {
          hasStartedSpeaking = true;
          this.setState('speaking');
          this.store.setAgentStatus('speaking');
        }
        spokenSoFar += (spokenSoFar ? ' ' : '') + sentenceText;
        this.lastSpokenAnswer = spokenSoFar;
        this.store.setCurrentEmotion(detectEmotion(sentenceText));
        if (currentSessionId) {
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
      }
    );

    if (this.activeRequestId) {
      pythonBackendService.cancel(this.activeRequestId);
      this.activeRequestId = null;
    }

    try {
      this.activeRequestId = pythonBackendService.sendMessage(
        trimmed,
        currentSessionId || 'session_default_general',
        {
          mode: this.store.agentModeType,
          modelProvider: providerToSend,
          maxTokens: 2048
        },
        {
          onSentence: (sentence: string) => {
            clearWatchdog();
            if (abortSignal.aborted) return;
            const cleaned = cleanTextForSpeech(sentence);
            if (cleaned.length > 0) {
              // Queue sentence to audio pipeline.
              // Note: DO NOT set speechText or append to chat here!
              // voiceManager will set speechText and invoke onSentenceStart when audio ACTUALLY starts playing!
              voiceManager.enqueueSentence(cleaned);
            }
          },
          onChunk: (chunk: string) => {
            clearWatchdog();
            if (abortSignal.aborted) return;
            accumulatedText += (accumulatedText ? ' ' : '') + chunk;
            // DO NOT appendLocalMessage here — keeps text from appearing ahead of voice!
          },
          onDone: (fullResponse: string, modelUsed: string, respSessionId?: string) => {
            clearWatchdog();
            if (abortSignal.aborted) return;
            this.activeRequestId = null;
            voiceManager.notifyStreamDone();

            const finalContent = fullResponse?.trim() || accumulatedText.trim();
            const targetSession = respSessionId || currentSessionId;

            // Retain pending complete content for sealing when audio finishes
            this.pendingAssistantMsg = {
              id: assistantMsgId,
              sessionId: targetSession || 'session_default_general',
              content: finalContent,
              modelUsed
            };

            const cleaned = cleanTextForSpeech(finalContent);
            this.lastSpokenAnswer = cleaned;
            this.store.setLastFullResponse(finalContent);
            this.store.setAgentModelName('Deep Think');
            this.store.setAgentSpeed('langgraph');
          },
          onError: (err: Error) => {
            clearWatchdog();
            if (abortSignal.aborted) return;
            this.activeRequestId = null;
            console.error('[Aura] Streaming conversation error:', err);
            voiceManager.stopAll('stream_error');
            this.isProcessingOrSpeaking = false;
            this.store.setAgentStatus('error');
            this.store.setError(err?.message || 'Query failed');
            setTimeout(() => {
              this.store.setAgentStatus('idle');
              this.setState('sleeping');
            }, 2000);
          },
          onToolStart: (toolName: string) => {
            clearWatchdog();
            if (abortSignal.aborted) return;
            this.store.setCurrentAgentAction(`Deep Think: Running ${toolName}...`);
          },
          onToolEnd: () => {
            clearWatchdog();
            if (abortSignal.aborted) return;
            this.store.setCurrentAgentAction('Deep Think: Synthesizing answer...');
          }
        }
      );
    } catch (err: any) {
      clearWatchdog();
      if (abortSignal.aborted) return;
      console.error('[Aura] processQuery error:', err);
      voiceManager.stopAll('query_error');
      this.isProcessingOrSpeaking = false;
      this.store.setAgentStatus('error');
      this.store.setError(err?.message || 'Query failed');
      setTimeout(() => {
        this.store.setAgentStatus('idle');
        this.setState('sleeping');
      }, 2000);
    }
  }

  private onResponseComplete() {
    this.isProcessingOrSpeaking = false;
    this.store.setAgentStatus('idle');
    this.store.setIsSpeaking(false);
    this.store.setPlaybackState('idle');

    // Seal the complete message into sessionStore when playback completes
    if (this.pendingAssistantMsg && this.pendingAssistantMsg.content) {
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

    // Enforce 1500ms echo suppression cooldown to guarantee zero feedback loop
    this.speechCooldownUntil = Date.now() + 1500;
    this.activeRecognizer?.clear();

    if (this.cooldownTimer) clearTimeout(this.cooldownTimer);
    this.cooldownTimer = setTimeout(() => {
      // In Always-On mode, resume listening cleanly
      if (this.store.isAlwaysOnMic && !this.isProcessingOrSpeaking) {
        this.startActiveListening();
      } else {
        this.stopActiveRecognizer();
        this.setState('sleeping');
        this.store.setIsListening(false);
      }
    }, 1500);
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
      const key = typeof window !== 'undefined' ? localStorage.getItem('elevenlabs_api_key') || '' : '';
      voiceManager.speak(farewell, voice, key);
    } else {
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
    this.inactivityTimer = setTimeout(() => {
      if (this.store.isListening && !this.store.isAlwaysOnMic) {
        this.returnToSleep('inactivity');
      }
    }, INACTIVITY_TIMEOUT_MS);
  }
}

export const auraController = new AuraConversationController();
