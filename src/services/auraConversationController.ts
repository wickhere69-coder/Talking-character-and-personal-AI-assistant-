import { useAppStore } from '@/store/appStore';
import { useSessionStore } from '@/store/sessionStore';
import {
  createSpeechRecognizer,
  isSpeechRecognitionSupported,
  type SpeechRecognizerController
} from './webSpeechService';
import { voiceManager } from './voiceManager';
import { sendAgentMessage } from './agentService';
import { detectEmotion } from './emotionDetector';
import { getSpeechCompletionDelay } from '@/utils/speechCompletionDelay';
import { isComplexReasoning } from '@/utils/reasoningDetector';
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
    window.addEventListener('session-switch', () => {
      this.streamAbort?.abort();
      voiceManager.stopAll('session_switch');
      this.isProcessingOrSpeaking = false;
      this.store.setIsSpeaking(false);
      this.store.setPlaybackState('idle');
      this.store.setAgentStatus('idle');
      this.setState('sleeping');
    });

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
      this.stopListening();
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

  private isEchoOfLastAnswer(text: string): boolean {
    if (!this.lastSpokenAnswer) return false;
    const t = text.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim();
    const a = this.lastSpokenAnswer.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim();
    if (t.length < 5) return false;
    if (a.includes(t)) return true;

    // Check word overlap: if >65% of words are from Aura's own last answer, it is an echo
    const tWords = t.split(/\s+/).filter(w => w.length > 3);
    if (tWords.length >= 4) {
      const matches = tWords.filter(w => a.includes(w));
      if (matches.length / tWords.length > 0.65) {
        return true;
      }
    }
    return false;
  }

  private startActiveListening() {
    this.stopActiveRecognizer();
    this.accumulated = '';

    this.activeRecognizer = createSpeechRecognizer({
      onTranscript: (transcript: string, isFinal: boolean) => {
        // Discard any incoming audio if character is currently speaking or in post-speech cooldown
        if (this.isProcessingOrSpeaking || Date.now() < this.speechCooldownUntil) {
          return;
        }

        const trimmed = transcript.trim();
        if (!trimmed) return;

        // Discard self-echo
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
    this.isProcessingOrSpeaking = true;
    this.clearTimers();
    this.activeRecognizer?.pause();
    this.activeRecognizer?.clear();
    this.accumulated = '';
    this.store.setIsListening(false);

    // Intelligently auto-switch to Deep Think (LangGraph) for complex problems / reasoning
    const isReasoning = isComplexReasoning(trimmed);
    const providerToSend = isReasoning
      ? 'langgraph'
      : (this.store.agentSpeed === 'instant' ? 'local_fallback' : (this.store.agentSpeed || 'gemini'));

    if (isReasoning) {
      this.store.setAgentModelName('Deep Think');
      this.store.setAgentSpeed('langgraph');
    } else if (this.store.agentSpeed !== 'langgraph' && this.store.agentSpeed !== 'instant') {
      this.store.setAgentModelName('Balanced');
      this.store.setAgentSpeed('gemini');
    }

    voiceManager.setOnPlaybackEnd(null);

    try {
      this.setState('thinking');
      this.store.setAgentStatus('thinking');
      this.store.setPlaybackState('loading');
      this.store.setError(null);
      this.store.setCurrentAgentAction('Thinking & analyzing query...');

            const sessionStore = useSessionStore.getState();
      const currentSessionId = sessionStore.activeSessionId;

      // Append user message to active session
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

      const res = await sendAgentMessage(trimmed, {
        mode: this.store.agentModeType,
        modelProvider: providerToSend,
        maxTokens: 2048
      }, currentSessionId || undefined);

      if (this.streamAbort?.signal.aborted) return;

      // Race guard: If user switched sessions while LLM was processing, drop response from old session
      if (currentSessionId && useSessionStore.getState().activeSessionId !== currentSessionId) {
        console.log('[Aura] Session switched during inference; discarding response from previous session.');
        return;
      }

      // Append assistant message to active session
      if (currentSessionId && res.response) {
        useSessionStore.getState().appendLocalMessage({
          id: `msg_a_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
          sessionId: currentSessionId,
          role: 'assistant',
          content: res.response,
          createdAt: Date.now(),
          status: 'delivered',
          modelUsed: res.modelUsed
        });
      }

      if (this.streamAbort?.signal.aborted) return;

      const fullResponse = res.response;
      if (!fullResponse?.trim()) {
        this.isProcessingOrSpeaking = false;
        this.store.setAgentStatus('idle');
        this.setState('sleeping');
        return;
      }

      // Synchronize intelligence mode
      if (res.modelUsed?.toLowerCase().includes('langgraph') || res.modelUsed?.toLowerCase().includes('reasoning') || isReasoning) {
        this.store.setAgentModelName('Deep Think');
        this.store.setAgentSpeed('langgraph');
      } else if (this.store.agentSpeed !== 'langgraph' && this.store.agentSpeed !== 'instant') {
        this.store.setAgentModelName('Balanced');
        this.store.setAgentSpeed('gemini');
      }

      // Save for echo suppression and voice playback
      const cleaned = cleanTextForSpeech(fullResponse);
      this.lastSpokenAnswer = cleaned;

      const emotion = detectEmotion(fullResponse);
      this.store.setCurrentEmotion(emotion);
      this.store.setCurrentSentence(cleaned);
      this.store.setSpeechText(cleaned);
      this.store.setLastFullResponse(fullResponse);

      this.setState('speaking');
      this.store.setAgentStatus('speaking');

      const voice = voiceManager.resolveCurrentVoice();
      const key = typeof window !== 'undefined'
        ? localStorage.getItem('elevenlabs_api_key') || ''
        : '';

      voiceManager.setOnPlaybackEnd(() => {
        voiceManager.setOnPlaybackEnd(null);
        this.onResponseComplete();
      });

      await voiceManager.speak(cleaned, voice, key);

    } catch (err: any) {
      if (this.streamAbort?.signal.aborted) return;
      console.error('[Aura] Query error:', err);
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

    // Enforce 800ms echo suppression cooldown to guarantee zero feedback loop
    this.speechCooldownUntil = Date.now() + 800;

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
    }, 800);
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
