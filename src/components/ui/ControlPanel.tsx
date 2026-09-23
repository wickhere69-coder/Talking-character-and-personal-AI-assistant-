import React, { useEffect, useCallback, useRef, useState } from 'react';
import { useAppStore } from '@/store/appStore';
import { loadAllCuratedVoices } from '@/services/ttsService';
import { saveElevenLabsKey } from '@/services/elevenLabsService';
import { 
  SpeechRecognizerController,
  createSpeechRecognizer, 
  isSpeechRecognitionSupported 
} from '@/services/webSpeechService';
import { voiceManager } from '@/services/voiceManager';
import { 
  sendAgentMessage, 
  streamAgentConversation,
  getAgentHealth, 
  clearAgentHistory, 
  saveAgentApiKey, 
  getAgentKeyStatus 
} from '@/services/agentService';
import {
  TYPO,
  BUTTONS,
  SURFACES,
  FORMS,
  STATUS_DOTS,
} from './designSystem';
import {
  Bot,
  Repeat,
  Zap,
  Mic,
  MicOff,
  Send,
  CornerDownLeft,
  Loader2,
  Play,
  Pause,
  Square,
  Folder,
  HardDrive,
  CheckSquare,
  Brain,
  HelpCircle,
  History,
  Trash2,
  Volume2,
  Key,
  Maximize2,
  Focus,
  Coffee,
  Tv,
  Upload,
  X,
  PanelRightOpen,
  Sparkles,
  ExternalLink,
  Sliders,
  ChevronDown,
  ChevronUp,
  MessageSquare,
  Waves,
  Radio
} from 'lucide-react';

/**
 * Dynamic speech endpoint delay calculation.
 * Ensures the assistant waits patiently until the user actually completes their thought/sentence,
 * avoiding mid-sentence cutoffs when users pause to think or breathe.
 */
function getSpeechCompletionDelay(
  transcript: string,
  isFinal: boolean,
  mode: 'conversational' | 'agent' | 'repeat' = 'conversational'
): number {
  if (mode === 'repeat') {
    return isFinal ? 400 : 700;
  }

  const text = transcript.trim().toLowerCase();
  if (!text) return 1500;

  const words = text.split(/\s+/).filter(Boolean);
  const wordCount = words.length;
  const lastWord = words[words.length - 1]?.replace(/[^a-z0-9']/g, '') || '';

  // Words that strongly indicate the user is mid-sentence, hesitating, or about to add another clause:
  const INCOMPLETE_TRAILING_WORDS = new Set([
    'and', 'but', 'or', 'so', 'because', 'although', 'though', 'while', 'whereas', 'yet',
    'to', 'for', 'with', 'about', 'of', 'in', 'at', 'from', 'by', 'on', 'into', 'through', 'between', 'under', 'over',
    'that', 'which', 'who', 'whom', 'whose', 'where', 'when', 'why', 'how', 'if', 'whether', 'as',
    'the', 'a', 'an', 'my', 'your', 'his', 'her', 'our', 'their', 'this', 'these', 'those',
    'is', 'are', 'was', 'were', 'am', 'be', 'been', 'being',
    'have', 'has', 'had', 'do', 'does', 'did',
    'can', 'could', 'will', 'would', 'shall', 'should', 'may', 'might', 'must',
    'like', 'uh', 'um', 'er', 'ah'
  ]);

  const endsWithIncompleteWord = INCOMPLETE_TRAILING_WORDS.has(lastWord);
  const endsWithTerminalPunctuation = /[.?!]$/.test(transcript.trim());

  // User paused right after an incomplete word ("I want to know about..."):
  // Give them a generous 1.2s window so they are never interrupted mid-thought.
  if (endsWithIncompleteWord) {
    return 1200;
  }

  // Short 1-2 word utterance (e.g. "Hey", "Can you"): wait 0.9s for sentence completion.
  if (wordCount <= 2) {
    return 900;
  }

  // Definite sentence closure with punctuation (. / ? / !):
  if (endsWithTerminalPunctuation && isFinal) {
    return 400;
  }

  // Natural pause after speaking a full clause/thought:
  // 600ms on final chunk, 1000ms on interim.
  return isFinal ? 600 : 1000;
}

export default function ControlPanel() {
  const {
    scriptText, setScriptText,
    playbackState, setPlaybackState,
    selectedVoice, setSelectedVoice,
    voices, setVoices,
    activeCamera, setActiveCamera,
    setIsSpeaking,
    setSpeechText,
    lipSyncDelayMs, setLipSyncDelayMs,
    isListening, setIsListening,
    autoRepeat,
    agentModeType, setAgentModeType,
    isConversationalActive, setIsConversationalActive,
    agentSpeed, setAgentSpeed,
    agentStatus, setAgentStatus,
    setCurrentAgentAction,
    setPendingConfirmation,
    setAgentModelName,
    sceneTheme, setSceneTheme,
    setCustomGlbUrl,
    setAudioUrl, setVisemeQueue,
    setActiveTaskSteps,
    setIsHistoryModalOpen,
    setLastFullResponse,
    setError
  } = useAppStore();

  const [isCollapsed, setIsCollapsed] = useState(false);
  const [activeNavTab, setActiveNavTab] = useState<'assistant' | 'studio'>('assistant');
  const [elevenLabsKey, setElevenLabsKey] = useState<string>(() => {
    return typeof window !== 'undefined' ? localStorage.getItem('elevenlabs_api_key') || '' : '';
  });
  const [grokKey, setGrokKey] = useState<string>(() => {
    return typeof window !== 'undefined' ? localStorage.getItem('grok_api_key') || localStorage.getItem('xai_api_key') || '' : '';
  });
  const [geminiKey, setGeminiKey] = useState<string>(() => {
    return typeof window !== 'undefined' ? localStorage.getItem('gemini_api_key') || '' : '';
  });
  const [keyStatuses, setKeyStatuses] = useState<{ grok: boolean; gemini: boolean; elevenlabs: boolean; }>({
    grok: false,
    gemini: false,
    elevenlabs: false
  });
  const [activeKeyTab, setActiveKeyTab] = useState<'grok' | 'gemini' | 'elevenlabs'>('gemini');
  const [showKeyConfig, setShowKeyConfig] = useState(false);
  const [keyToastMessage, setKeyToastMessage] = useState<string | null>(null);
  const [historyClearedToast, setHistoryClearedToast] = useState(false);
  const [voiceFilterTab, setVoiceFilterTab] = useState<'all' | 'azure' | 'elevenlabs' | 'webSpeech'>('all');
  const [agentHealthInfo, setAgentHealthInfo] = useState<{
    connected: boolean;
    model: string;
    toolsCount: number;
    memoryReady: boolean;
  }>({
    connected: true,
    model: 'llama3.2:3b',
    toolsCount: 28,
    memoryReady: true
  });

  const recognitionRef = useRef<SpeechRecognizerController | null>(null);
  const silenceTimerRef = useRef<any>(null);
  const isAskingRef = useRef(false);
  const autoRepeatRef = useRef(autoRepeat);
  autoRepeatRef.current = autoRepeat;
  const userWantsListeningRef = useRef(false);

  // Conversational duplex character mode refs
  const conversationalAbortControllerRef = useRef<AbortController | null>(null);
  const conversationalSilenceTimerRef = useRef<any>(null);
  const conversationalActiveRef = useRef(false);
  const isStartingConversationalRef = useRef(false);
  const startConversationalListeningRef = useRef<() => void>(() => {});
  const processConversationalTurnRef = useRef<(text: string) => Promise<void>>(async () => {});

  // Load voices & agent health on mount
  useEffect(() => {
    async function init() {
      const allVoices = await loadAllCuratedVoices();
      setVoices(allVoices);

      const savedVoice = typeof window !== 'undefined' ? localStorage.getItem('talking_character_selected_voice') : null;
      const validSaved = savedVoice ? allVoices.find(v => v.id === savedVoice) : null;
      if (validSaved) {
        setSelectedVoice(validSaved.id);
      } else if (allVoices.length > 0) {
        const defaultVoice = allVoices[0];
        setSelectedVoice(defaultVoice.id);
        if (typeof window !== 'undefined') {
          try { localStorage.setItem('talking_character_selected_voice', defaultVoice.id); } catch {}
        }
      }

      const health = await getAgentHealth();
      if (health) {
        const isConnected = health.status === 'healthy';
        const modelName = health.provider?.modelInfo?.name || 'llama3.2:3b';
        setAgentModelName(modelName);
        setAgentHealthInfo({
          connected: isConnected,
          model: modelName,
          toolsCount: health.toolsRegistered || 28,
          memoryReady: true
        });
      } else {
        setAgentHealthInfo(prev => ({ ...prev, connected: false }));
      }

      const status = await getAgentKeyStatus();
      if (status) {
        setKeyStatuses(status);
      }
    }
    init();
  }, [setVoices, setSelectedVoice, setAgentModelName]);

  const startListeningRef = useRef<() => void>(() => {});

  // Sub-second repeat loop: Re-arm microphone when character finishes speaking
  useEffect(() => {
    voiceManager.setOnPlaybackEnd(() => {
      const state = useAppStore.getState();
      if (state.agentModeType === 'repeat') {
        setScriptText('');
        if (state.autoRepeat && !isAskingRef.current) {
          // Immediately re-open microphone for smooth conversational practice
          setTimeout(() => {
            const freshState = useAppStore.getState();
            if (freshState.autoRepeat && !freshState.isSpeaking && !freshState.isListening) {
              startListeningRef.current?.();
            }
          }, 60);
        }
      }
    });
    return () => {
      voiceManager.setOnPlaybackEnd(null);
    };
  }, [setScriptText]);

  const stopListening = useCallback(() => {
    userWantsListeningRef.current = false;
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
    if (recognitionRef.current) {
      try { recognitionRef.current.abort(); } catch {}
      try { recognitionRef.current.stop(); } catch {}
      recognitionRef.current = null;
    }
    setIsListening(false);
  }, [setIsListening]);

  // Clean Markdown syntax before sending to speech engine
  const cleanTextForSpeech = (text: string): string => {
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
  };

  const speakAndSync = useCallback(async (textToSpeak: string, isInstantRepeat: boolean = false) => {
    const cleaned = cleanTextForSpeech(textToSpeak);
    if (!cleaned) return;

    // Immediately shut off microphone so character never speaks into its own mic
    stopListening();
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }

    const store = useAppStore.getState();
    const activeVoice = store.voices.find(v => v.id === store.selectedVoice) || store.voices[0];
    const key = elevenLabsKey || (typeof window !== 'undefined' ? localStorage.getItem('elevenlabs_api_key') || '' : '');
    await voiceManager.speak(cleaned, activeVoice, key, isInstantRepeat);
  }, [elevenLabsKey, stopListening]);

  // Main Agent Ask Handler
  const handleAskAgent = useCallback(async (textToAsk: string) => {
    const trimmed = textToAsk?.trim();
    if (!trimmed || isAskingRef.current) return;

    isAskingRef.current = true;
    console.log(`[TASK] Initiating agent query: "${trimmed}"`);

    // Immediately stop microphone & any active silence timers
    stopListening();
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }

    // Stop all active speech & in-flight synthesis
    voiceManager.stopAll('new_task');

    // Immediately clear prompt box for next turn
    setScriptText('');

    setAgentStatus('thinking');
    setCurrentAgentAction(null);
    setPlaybackState('loading');
    setError(null);
    setActiveTaskSteps([{ title: 'Processing answer...', status: 'in_progress' }]);

    try {
      const providerMapping = agentSpeed === 'instant' ? 'local_fallback' : (agentSpeed || 'gemini');
      const res = await sendAgentMessage(trimmed, {
        mode: agentModeType,
        modelProvider: providerMapping,
        maxTokens: 2048
      });

      console.log(`[AI RESPONSE] Received response (${res.modelUsed || 'default'}): "${(res.response || '').substring(0, 80)}..."`);

      if (res.modelUsed) {
        const readableModel =
          res.modelUsed === 'grok'
            ? 'xAI Grok 4.7'
            : res.modelUsed === 'gemini'
            ? 'Google Gemini 3.8 Flash'
            : 'Fast Local Engine';
        setAgentModelName(readableModel);
      }

      if (res.pendingConfirmation) {
        setPendingConfirmation(res.pendingConfirmation);
        setAgentStatus('awaiting_confirmation');
        await speakAndSync(res.response);
      } else {
        setAgentStatus('speaking');
        if (res.toolsExecuted && res.toolsExecuted.length > 0) {
          const toolNames = res.toolsExecuted.map((t) => t.name).join(', ');
          setCurrentAgentAction(`Executed: ${toolNames}`);
          setActiveTaskSteps([
            { title: 'Analyze user prompt', status: 'completed' },
            { title: `Executed: ${toolNames}`, status: 'completed' },
            { title: 'Synthesize response', status: 'completed' }
          ]);
        } else {
          setActiveTaskSteps([
            { title: 'Analyze user prompt', status: 'completed' },
            { title: 'Evaluate local capabilities & tools', status: 'completed' },
            { title: 'Synthesize spoken response', status: 'completed' }
          ]);
          setTimeout(() => {
            setActiveTaskSteps([]);
          }, 1200);
        }

        // Store full response for viewer modal
        setLastFullResponse(res.response);
        await speakAndSync(res.response);
      }
    } catch (err: any) {
      console.error('Agent query error:', err);
      setAgentStatus('error');
      setError(err?.message || 'Agent error');
      setActiveTaskSteps([]);
      await speakAndSync(`I encountered an issue processing your request: ${err?.message || 'Unknown error'}`);
    } finally {
      isAskingRef.current = false;
    }
  }, [agentModeType, agentSpeed, setAgentStatus, setCurrentAgentAction, setPlaybackState, setError, setActiveTaskSteps, setAgentModelName, setPendingConfirmation, setScriptText, setLastFullResponse, speakAndSync, stopListening]);

  // Speech Recognition: Start listening
  const startListening = useCallback(() => {
    if (!isSpeechRecognitionSupported()) {
      setError('Microphone speech recognition requires Google Chrome, Edge, or Brave browser.');
      return;
    }

    // Hard-cancel any active audio/speech before listening
    voiceManager.stopAll('start_listening');
    setAgentStatus('listening');
    userWantsListeningRef.current = true;

    if (recognitionRef.current) {
      try { recognitionRef.current.abort(); } catch {}
      recognitionRef.current = null;
    }

    let accumulated = '';

    const recognition = createSpeechRecognizer({
      onTranscript: (transcript: string, isFinal: boolean) => {
        accumulated = transcript;
        setScriptText(transcript);

        if (silenceTimerRef.current) {
          clearTimeout(silenceTimerRef.current);
        }

        const isRepeat = useAppStore.getState().agentModeType === 'repeat';
        // Intelligent sentence completion delay: waits until user finishes sentence
        const delay = getSpeechCompletionDelay(accumulated, isFinal, isRepeat ? 'repeat' : 'agent');

        silenceTimerRef.current = setTimeout(async () => {
          userWantsListeningRef.current = false;
          stopListening();
          const toProcess = accumulated.trim();
          accumulated = '';
          if (toProcess) {
            if (isRepeat) {
              await speakAndSync(toProcess, true);
            } else {
              await handleAskAgent(toProcess);
            }
          }
        }, delay);
      },
      onEnd: () => {
        setIsListening(false);
        if (useAppStore.getState().agentStatus === 'listening') {
          setAgentStatus('idle');
        }
      },
      onError: (err) => {
        console.warn('Speech recognition notice:', err);
        if (err === 'no-speech' && userWantsListeningRef.current) {
          return; // Ignore transient no-speech timeouts; keep listening
        }
        userWantsListeningRef.current = false;
        setIsListening(false);
        setAgentStatus('idle');
      }
    });

    if (recognition) {
      try {
        recognition.start();
        recognitionRef.current = recognition;
        setIsListening(true);
      } catch (e) {
        console.error('Could not start microphone', e);
        userWantsListeningRef.current = false;
        setIsListening(false);
        setAgentStatus('idle');
      }
    }
  }, [agentModeType, setScriptText, setIsListening, setAgentStatus, setError, handleAskAgent, speakAndSync, stopListening]);

  startListeningRef.current = startListening;

  // ── Conversational Duplex Mode Handlers ──
  const stopConversationalMode = useCallback(() => {
    isStartingConversationalRef.current = false;
    conversationalActiveRef.current = false;
    setIsConversationalActive(false);
    if (conversationalSilenceTimerRef.current) {
      clearTimeout(conversationalSilenceTimerRef.current);
      conversationalSilenceTimerRef.current = null;
    }
    if (conversationalAbortControllerRef.current) {
      conversationalAbortControllerRef.current.abort();
      conversationalAbortControllerRef.current = null;
    }
    if (recognitionRef.current) {
      try { recognitionRef.current.abort(); } catch {}
      recognitionRef.current = null;
    }
    voiceManager.stopAll('end_conversation');
    stopListening();
    setAgentStatus('idle');
    setIsListening(false);
  }, [setIsConversationalActive, stopListening, setAgentStatus, setIsListening]);

  const processConversationalTurn: (userTranscript: string) => Promise<void> = useCallback(async (userTranscript: string) => {
    if (!conversationalActiveRef.current) return;
    const trimmed = userTranscript.trim();
    if (!trimmed) {
      if (conversationalActiveRef.current) {
        startConversationalListeningRef.current();
      }
      return;
    }

    console.log(`[CONVERSATION] Processing user turn: "${trimmed}"`);

    // STOP MICROPHONE immediately so character's voice from speakers is NEVER recorded!
    if (conversationalSilenceTimerRef.current) {
      clearTimeout(conversationalSilenceTimerRef.current);
      conversationalSilenceTimerRef.current = null;
    }
    if (recognitionRef.current) {
      try { recognitionRef.current.abort(); } catch {}
      recognitionRef.current = null;
    }
    setIsListening(false);

    setAgentStatus('thinking');
    setActiveTaskSteps([{ title: 'Thinking & streaming answer...', status: 'in_progress' }]);

    // Abort previous stream if any
    if (conversationalAbortControllerRef.current) {
      conversationalAbortControllerRef.current.abort();
    }
    const abortController = new AbortController();
    conversationalAbortControllerRef.current = abortController;

    // Read agentSpeed from store at call-time to avoid stale closure when user switches engine mid-conversation
    const currentSpeed = useAppStore.getState().agentSpeed;
    const providerMapping = currentSpeed === 'instant' ? 'local_fallback' : (currentSpeed || 'gemini');
    let sentenceCount = 0;

    // Start stream playback session with safe turn completion handler
    voiceManager.startStreamSession(() => {
      if (conversationalActiveRef.current) {
        setActiveTaskSteps([]);
        setAgentStatus('listening');
        startConversationalListeningRef.current();
      }
    });

    try {
      await streamAgentConversation(
        trimmed,
        {
          mode: 'conversational',
          modelProvider: providerMapping,
          maxTokens: 2048 // Full token budget for Gemini 3.8 Flash high reasoning tokens
        },
        {
          onSentence: (sentence) => {
            if (!conversationalActiveRef.current) return;
            sentenceCount++;
            const currentScript = useAppStore.getState().scriptText;
            const updatedScript = sentenceCount === 1 ? sentence : `${currentScript} ${sentence}`.trim();
            setScriptText(updatedScript);
            setSpeechText(sentence);
            if (sentenceCount === 1) {
              setAgentStatus('speaking');
              setActiveTaskSteps([
                { title: 'Processing prompt', status: 'completed' },
                { title: 'Streaming spoken response', status: 'in_progress' }
              ]);
            }
            voiceManager.enqueueSentence(sentence);
          },
          onComplete: (fullResponse, modelUsed) => {
            setLastFullResponse(fullResponse);
            // Update the full transcript display but do NOT overwrite the per-sentence
            // speechText that LowerThird is currently highlighting — that would cause
            // the subtitle to jump from the current sentence to the full multi-sentence response.
            if (fullResponse) {
              setScriptText(fullResponse);
            }
            if (modelUsed) {
              const readable =
                modelUsed === 'grok' ? 'xAI Grok 4.7'
                : modelUsed === 'gemini' ? 'Google Gemini 3.8 Flash'
                : 'Fast Local Engine';
              setAgentModelName(readable);
            }

            // Guaranteed speech handoff: if no streaming chunks were enqueued, speak full response directly
            if (sentenceCount === 0 && fullResponse.trim() && conversationalActiveRef.current) {
              setAgentStatus('speaking');
              setActiveTaskSteps([
                { title: 'Processing prompt', status: 'completed' },
                { title: 'Speaking response', status: 'in_progress' }
              ]);
              voiceManager.speakSentence(fullResponse.trim(), () => {
                if (conversationalActiveRef.current) {
                  setActiveTaskSteps([]);
                  setAgentStatus('listening');
                  startConversationalListeningRef.current();
                }
              });
            } else {
              voiceManager.notifyStreamDone();
            }
          },
          onError: (err) => {
            console.warn('[CONVERSATION] Stream notice:', err);
            // Guaranteed response: speak friendly fallback rather than silently cycling to listening
            if (sentenceCount === 0 && conversationalActiveRef.current) {
              const fallbackMsg = "I'm right here with you! Could you please repeat that?";
              setScriptText(fallbackMsg);
              setSpeechText(fallbackMsg);
              setAgentStatus('speaking');
              voiceManager.speakSentence(fallbackMsg, () => {
                if (conversationalActiveRef.current) {
                  setActiveTaskSteps([]);
                  setAgentStatus('listening');
                  startConversationalListeningRef.current();
                }
              });
            } else {
              voiceManager.notifyStreamDone();
            }
          }
        },
        abortController.signal
      );
    } catch (err: any) {
      console.error('[CONVERSATION] Turn error:', err);
      if (sentenceCount === 0 && conversationalActiveRef.current) {
        const fallbackMsg = "I'm right here with you! What would you like to explore?";
        setScriptText(fallbackMsg);
        setSpeechText(fallbackMsg);
        setAgentStatus('speaking');
        voiceManager.speakSentence(fallbackMsg, () => {
          if (conversationalActiveRef.current) {
            setActiveTaskSteps([]);
            setAgentStatus('listening');
            startConversationalListeningRef.current();
          }
        });
      } else {
        voiceManager.notifyStreamDone();
      }
    }
  }, [setAgentStatus, setActiveTaskSteps, setLastFullResponse, setAgentModelName, setIsListening, setScriptText, setSpeechText]);

  const startConversationalListening: () => void = useCallback(() => {
    if (!conversationalActiveRef.current) return;
    if (!isSpeechRecognitionSupported()) {
      setError('Microphone speech recognition requires Google Chrome, Edge, or Brave browser.');
      stopConversationalMode();
      return;
    }

    setAgentStatus('listening');
    setIsListening(true);
    userWantsListeningRef.current = true;

    if (recognitionRef.current) {
      try { recognitionRef.current.abort(); } catch {}
      recognitionRef.current = null;
    }

    let currentTranscript = '';

    const recognition = createSpeechRecognizer({
      onTranscript: (transcript: string, isFinal: boolean) => {
        if (!conversationalActiveRef.current) return;

        // ACOUSTIC ISOLATION: Discard any audio if the assistant is speaking or playing sound!
        const state = useAppStore.getState();
        if (state.isSpeaking || state.playbackState === 'playing' || state.agentStatus === 'speaking' || state.agentStatus === 'thinking') {
          return;
        }

        currentTranscript = transcript;
        setScriptText(transcript);

        if (conversationalSilenceTimerRef.current) {
          clearTimeout(conversationalSilenceTimerRef.current);
        }

        // Intelligent sentence completion delay: waits until user completes thought
        const delay = getSpeechCompletionDelay(transcript, isFinal, 'conversational');
        conversationalSilenceTimerRef.current = setTimeout(() => {
          const phrase = currentTranscript.trim();
          currentTranscript = '';
          if (phrase && conversationalActiveRef.current) {
            processConversationalTurnRef.current(phrase);
          }
        }, delay);
      },
      onEnd: () => {
        if (conversationalActiveRef.current) {
          const state = useAppStore.getState();
          if (!state.isSpeaking && state.playbackState !== 'playing' && state.agentStatus === 'listening') {
            setTimeout(() => {
              if (conversationalActiveRef.current && !useAppStore.getState().isSpeaking && useAppStore.getState().agentStatus === 'listening') {
                startConversationalListeningRef.current();
              }
            }, 100);
          }
        } else {
          setIsListening(false);
        }
      },
      onError: (err) => {
        console.warn('Conversational speech recognition notice:', err);
        if (err === 'no-speech' && conversationalActiveRef.current) {
          return;
        }
      }
    });

    if (recognition) {
      try {
        recognition.start();
        recognitionRef.current = recognition;
        setIsListening(true);
      } catch (e) {
        console.error('Could not start microphone for conversation', e);
      }
    }
  }, [setError, stopConversationalMode, setAgentStatus, setIsListening, setScriptText]);

  startConversationalListeningRef.current = startConversationalListening;
  processConversationalTurnRef.current = processConversationalTurn;

  const startConversationalMode = useCallback(async () => {
    if (isStartingConversationalRef.current || conversationalActiveRef.current) return;
    isStartingConversationalRef.current = true;

    // Hard stop any other active speech, recognizers, or timers
    stopListening();
    if (conversationalSilenceTimerRef.current) {
      clearTimeout(conversationalSilenceTimerRef.current);
      conversationalSilenceTimerRef.current = null;
    }
    if (recognitionRef.current) {
      try { recognitionRef.current.abort(); } catch {}
      recognitionRef.current = null;
    }
    voiceManager.stopAll('start_conversation');

    conversationalActiveRef.current = true;
    setIsConversationalActive(true);
    setAgentModeType('conversational');
    setAgentSpeed('gemini');
    setAgentModelName('Google Gemini 3.8 Flash');
    setAgentStatus('speaking');

    // Assistant Introduction
    const introText = "Hey there.";
    setScriptText(introText);
    setLastFullResponse(introText);

    try {
      await voiceManager.speakSentence(introText, () => {
        isStartingConversationalRef.current = false;
        if (conversationalActiveRef.current) {
          setScriptText('');
          startConversationalListening();
        }
      });
    } catch {
      isStartingConversationalRef.current = false;
      if (conversationalActiveRef.current) {
        startConversationalListening();
      }
    }
  }, [setIsConversationalActive, setAgentSpeed, setAgentModelName, setAgentStatus, setScriptText, setLastFullResponse, startConversationalListening, stopListening]);

  const handleConversationalBargeIn = () => {
    voiceManager.stopAll('user_manual_interruption');
    if (conversationalAbortControllerRef.current) {
      conversationalAbortControllerRef.current.abort();
      conversationalAbortControllerRef.current = null;
    }
    setAgentStatus('listening');
    setIsSpeaking(false);
    setPlaybackState('idle');
    startConversationalListening();
  };

  const handleModeSwitch = (mode: 'agent' | 'conversational' | 'repeat') => {
    stopListening();
    if (conversationalSilenceTimerRef.current) {
      clearTimeout(conversationalSilenceTimerRef.current);
      conversationalSilenceTimerRef.current = null;
    }
    if (recognitionRef.current) {
      try { recognitionRef.current.abort(); } catch {}
      recognitionRef.current = null;
    }

    if (isConversationalActive && mode !== 'conversational') {
      stopConversationalMode();
    }
    if (mode === 'conversational') {
      setAgentSpeed('gemini');
      setAgentModelName('Google Gemini 3.8 Flash');
    }
    setAgentModeType(mode);
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      conversationalActiveRef.current = false;
      if (conversationalSilenceTimerRef.current) {
        clearTimeout(conversationalSilenceTimerRef.current);
      }
      if (conversationalAbortControllerRef.current) {
        conversationalAbortControllerRef.current.abort();
      }
    };
  }, []);

  const toggleMic = () => {
    if (isListening) {
      stopListening();
      setAgentStatus('idle');
    } else {
      voiceManager.stopAll('toggle_mic');
      startListening();
    }
  };

  const handlePlay = () => {
    stopListening();
    if (playbackState === 'playing') {
      voiceManager.stopAll('user_pause');
      setPlaybackState('paused');
    } else {
      speakAndSync(scriptText, agentModeType === 'repeat');
    }
  };

  const handleStop = () => {
    if (isConversationalActive) {
      stopConversationalMode();
    }
    stopListening();
    voiceManager.stopAll('user_stop_button');
    setAgentStatus('idle');
    setActiveTaskSteps([]);
    if (useAppStore.getState().agentModeType === 'repeat') {
      setScriptText('');
    }
  };

  const handlePreviewVoice = () => {
    stopListening();
    const cur = voices.find(v => v.id === selectedVoice);
    if (!cur) return;
    voiceManager.playPreview(cur);
  };

  const handleQuickAction = (promptText: string) => {
    stopListening();
    setScriptText(promptText);
    handleAskAgent(promptText);
  };

  const handleSelectEngine = (speed: 'grok' | 'gemini' | 'instant') => {
    setAgentSpeed(speed as any);
    const readable =
      speed === 'grok'
        ? 'xAI Grok 4.7'
        : speed === 'gemini'
        ? 'Google Gemini 3.8 Flash'
        : 'Fast Instant Engine';
    setAgentModelName(readable);
  };

  const activeEngineLabel =
    agentSpeed === 'grok'
      ? 'xAI Grok 4.7'
      : agentSpeed === 'gemini'
      ? 'Google Gemini 3.8 Flash'
      : 'Fast Instant Engine';

  return (
    <>
      {/* Refined Sidebar Toggle when collapsed - Solid Dark, NO backdrop-blur */}
      {isCollapsed && (
        <button
          type="button"
          onClick={() => setIsCollapsed(false)}
          className="fixed top-5 right-5 z-50 px-3 py-2 rounded-xl bg-[#0F0F12] hover:bg-[#141417] border border-white/[0.08] hover:border-white/[0.14] text-white shadow-[0_16px_36px_rgba(0,0,0,0.6)] transition-[transform,background-color,border-color] duration-150 ease-out flex items-center gap-2 text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8B5CF6]/50 active:scale-[0.98]"
          title="Open Studio AI Agent Panel"
        >
          <PanelRightOpen size={16} strokeWidth={1.5} className="text-[#8B5CF6]" />
          <span>Assistant</span>
        </button>
      )}

      {/* Main Floating Application Panel - Solid Dark Layer (No GPU blur flicker) */}
      <aside 
        aria-label="Studio AI Agent Control Panel"
        className={`fixed right-5 top-5 bottom-5 w-[370px] max-md:w-[92vw] max-md:right-[4vw] z-40 transition-[transform,opacity] duration-200 ease-out transform-gpu pointer-events-auto ${
          isCollapsed ? 'translate-x-[400px] opacity-0 pointer-events-none' : 'translate-x-0 opacity-100'
        }`}
      >
        <div className={`h-full ${SURFACES.panelShell} p-4 flex flex-col gap-3 overflow-y-auto custom-scrollbar`}>

          {/* ── 1. Header Card ── */}
          <div className="bg-[#141417] rounded-xl border border-white/[0.06] p-3.5 flex items-center justify-between">
            <div className="flex flex-col gap-0.5">
              <h1 className={TYPO.title}>
                STUDIO AI AGENT
              </h1>
              <span className={TYPO.caption}>
                Local Digital Personal Assistant
              </span>
            </div>

            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[#0A0A0C] border border-white/[0.06] text-[11px] font-mono text-white/60">
                <span className={agentHealthInfo.connected ? STATUS_DOTS.success : STATUS_DOTS.danger} />
                <span className="tracking-wide">{agentHealthInfo.connected ? 'CONNECTED' : 'OFFLINE'}</span>
              </div>

              <button
                type="button"
                onClick={() => setIsCollapsed(true)}
                className={BUTTONS.icon}
                title="Minimize Panel"
              >
                <X size={15} strokeWidth={1.5} />
              </button>
            </div>
          </div>

          {/* ── 2. Top-Level Tab Switcher (Calm Density Architecture) ── */}
          <div className="grid grid-cols-2 gap-1 p-1 bg-[#0A0A0C] border border-white/[0.04] rounded-xl">
            <button
              type="button"
              onClick={() => setActiveNavTab('assistant')}
              className={`py-2 px-3 rounded-lg text-xs font-medium transition-[transform,background-color,color] duration-150 ease-out flex items-center justify-center gap-2 active:scale-[0.98] ${
                activeNavTab === 'assistant'
                  ? 'bg-white/[0.08] text-white shadow-sm font-semibold'
                  : 'text-white/50 hover:text-white/80 hover:bg-white/[0.03]'
              }`}
            >
              <Bot size={14} strokeWidth={1.5} className={activeNavTab === 'assistant' ? 'text-[#8B5CF6]' : 'text-white/40'} />
              <span>Assistant</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveNavTab('studio')}
              className={`py-2 px-3 rounded-lg text-xs font-medium transition-[transform,background-color,color] duration-150 ease-out flex items-center justify-center gap-2 active:scale-[0.98] ${
                activeNavTab === 'studio'
                  ? 'bg-white/[0.08] text-white shadow-sm font-semibold'
                  : 'text-white/50 hover:text-white/80 hover:bg-white/[0.03]'
              }`}
            >
              <Sliders size={14} strokeWidth={1.5} className={activeNavTab === 'studio' ? 'text-[#8B5CF6]' : 'text-white/40'} />
              <span>Studio & Settings</span>
            </button>
          </div>

          {/* ══════════════════════════════════════════════════════════════ */}
          {/* TAB 1: ASSISTANT (The focused core conversational loop)     */}
          {/* ══════════════════════════════════════════════════════════════ */}
          {activeNavTab === 'assistant' && (
            <>
              {/* ── 3. AI Mode Switcher (Segmented Control: Agent, Converse, Repeat) ── */}
              <div className="bg-[#141417] rounded-xl border border-white/[0.06] p-2.5">
                <div className="grid grid-cols-3 gap-1 p-1 bg-[#0A0A0C] border border-white/[0.04] rounded-xl">
                  <button
                    type="button"
                    onClick={() => handleModeSwitch('agent')}
                    className={`py-1.5 px-1.5 rounded-lg text-[10.5px] font-semibold uppercase tracking-wider transition-[transform,background-color,color,box-shadow] duration-150 ease-out flex items-center justify-center gap-1 active:scale-[0.98] ${
                      agentModeType === 'agent'
                        ? 'bg-gradient-to-r from-[#8B5CF6] to-[#7C3AED] text-white shadow-[0_1px_8px_rgba(139,92,246,0.3)]'
                        : 'text-white/50 hover:text-white hover:bg-white/[0.04]'
                    }`}
                    title="Full agent mode: reasoning, memory, and local tool execution"
                  >
                    <Bot size={13} strokeWidth={1.5} />
                    <span>AGENT</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleModeSwitch('conversational')}
                    className={`py-1.5 px-1.5 rounded-lg text-[10.5px] font-semibold uppercase tracking-wider transition-[transform,background-color,color,box-shadow] duration-150 ease-out flex items-center justify-center gap-1 active:scale-[0.98] ${
                      agentModeType === 'conversational'
                        ? 'bg-gradient-to-r from-[#8B5CF6] to-[#7C3AED] text-white shadow-[0_1px_8px_rgba(139,92,246,0.3)]'
                        : 'text-white/50 hover:text-white hover:bg-white/[0.04]'
                    }`}
                    title="Natural conversational duplex mode: fast listen-think-respond loop with streaming & barge-in interruption"
                  >
                    <MessageSquare size={13} strokeWidth={1.5} />
                    <span>CONVERSE</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleModeSwitch('repeat')}
                    className={`py-1.5 px-1.5 rounded-lg text-[10.5px] font-semibold uppercase tracking-wider transition-[transform,background-color,color,box-shadow] duration-150 ease-out flex items-center justify-center gap-1 active:scale-[0.98] ${
                      agentModeType === 'repeat'
                        ? 'bg-gradient-to-r from-[#8B5CF6] to-[#7C3AED] text-white shadow-[0_1px_8px_rgba(139,92,246,0.3)]'
                        : 'text-white/50 hover:text-white hover:bg-white/[0.04]'
                    }`}
                    title="Direct speech synthesis & voice repeat"
                  >
                    <Repeat size={13} strokeWidth={1.5} />
                    <span>REPEAT</span>
                  </button>
                </div>
              </div>

              {/* ── 3b. Fluid Voice Orb Card (Minimalist Voice Hub) ── */}
              {agentModeType === 'conversational' && (
                <div className="bg-[#121215] rounded-2xl border border-white/[0.08] p-6 flex flex-col items-center justify-center gap-6 relative overflow-hidden shadow-[0_8px_32px_rgba(0,0,0,0.6)] my-2">
                  {/* Atmospheric ambient background glow */}
                  <div className={`absolute w-56 h-56 rounded-full blur-3xl pointer-events-none transition-all duration-700 ${
                    agentStatus === 'listening'
                      ? 'bg-emerald-500/20'
                      : agentStatus === 'thinking'
                      ? 'bg-violet-600/25'
                      : agentStatus === 'speaking'
                      ? 'bg-cyan-500/25'
                      : 'bg-[#8B5CF6]/20'
                  }`} />

                  {/* The Voice Orb Ball */}
                  <div 
                    onClick={() => {
                      if (!isConversationalActive) {
                        startConversationalMode();
                      } else if (agentStatus === 'speaking' || playbackState === 'playing') {
                        handleConversationalBargeIn();
                      }
                    }}
                    className="relative w-48 h-48 flex items-center justify-center cursor-pointer group select-none my-2"
                    title={
                      !isConversationalActive
                        ? 'Click to Start Voice Conversation'
                        : agentStatus === 'speaking'
                        ? 'Click Orb to Interrupt'
                        : 'Voice Conversation Active'
                    }
                  >
                    {/* Concentric Animated Soundwave Ripple Rings */}
                    {isConversationalActive && (
                      <>
                        <div className={`absolute inset-0 rounded-full border animate-ring-pulse ${
                          agentStatus === 'listening' ? 'border-emerald-400/40' : 'border-[#8B5CF6]/40'
                        }`} />
                        <div className={`absolute -inset-4 rounded-full border animate-ring-pulse [animation-delay:0.8s] ${
                          agentStatus === 'listening' ? 'border-emerald-400/20' : 'border-[#38BDF8]/25'
                        }`} />
                      </>
                    )}

                    {/* Luminous Animated Voice Orb Ball */}
                    <div className={`relative w-36 h-36 rounded-full transition-all duration-500 transform group-hover:scale-105 active:scale-95 ${
                      !isConversationalActive
                        ? 'bg-[radial-gradient(circle_at_32%_30%,#FFFFFF_0%,#A78BFA_28%,#8B5CF6_55%,#3B82F6_82%,#10B981_100%)] animate-orb-breathe animate-orb-morph shadow-[0_0_55px_rgba(139,92,246,0.5),0_0_95px_rgba(56,189,248,0.3)]'
                        : agentStatus === 'listening'
                        ? 'bg-[radial-gradient(circle_at_32%_30%,#FFFFFF_0%,#6EE7B7_28%,#10B981_55%,#06B6D4_82%,#8B5CF6_100%)] animate-orb-listening shadow-[0_0_70px_rgba(16,185,129,0.65),0_0_120px_rgba(56,189,248,0.45)]'
                        : agentStatus === 'thinking'
                        ? 'bg-[radial-gradient(circle_at_32%_30%,#FFFFFF_0%,#C084FC_28%,#8B5CF6_55%,#4F46E5_82%,#06B6D4_100%)] animate-orb-thinking shadow-[0_0_70px_rgba(139,92,246,0.65),0_0_120px_rgba(192,132,252,0.45)]'
                        : 'bg-[radial-gradient(circle_at_32%_30%,#FFFFFF_0%,#93C5FD_25%,#8B5CF6_55%,#EC4899_80%,#3B82F6_100%)] animate-orb-speaking shadow-[0_0_80px_rgba(139,92,246,0.75),0_0_140px_rgba(96,165,250,0.55)]'
                    }`}>
                      {/* Pearlescent Specular Glass Highlights */}
                      <div className="absolute inset-0 rounded-full bg-gradient-to-b from-white/40 via-transparent to-black/25 pointer-events-none" />
                      <div className="absolute top-3 left-5 w-10 h-5 rounded-full bg-white/45 blur-[1.5px] transform -rotate-12 pointer-events-none" />
                      <div className="absolute bottom-3.5 right-5 w-8 h-3.5 rounded-full bg-white/20 blur-[2px] transform rotate-12 pointer-events-none" />
                    </div>
                  </div>

                  {/* Status Indicator (Only when active) */}
                  {isConversationalActive && (
                    <div className="flex flex-col items-center gap-2 w-full">
                      <div className="flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-[#0A0A0C] border border-white/[0.08] text-xs font-medium text-white/90">
                        {agentStatus === 'listening' ? (
                          <>
                            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse shadow-[0_0_8px_#34D399]" />
                            <span>Listening...</span>
                          </>
                        ) : agentStatus === 'thinking' ? (
                          <>
                            <Loader2 size={12} strokeWidth={2} className="text-[#8B5CF6] animate-spin" />
                            <span>Thinking...</span>
                          </>
                        ) : (
                          <>
                            <span className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse shadow-[0_0_8px_#38BDF8]" />
                            <span>Speaking (tap orb to interrupt)</span>
                          </>
                        )}
                      </div>

                      {/* Live Transcription Bubble — always in DOM to prevent layout shift on words */}
                      <div className={`w-full bg-[#0A0A0C]/90 border border-white/[0.06] rounded-xl px-3 py-2 text-xs text-white/70 italic text-center max-h-16 overflow-y-auto custom-scrollbar transition-opacity duration-150 ${scriptText ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}>
                        "{scriptText}"
                      </div>
                    </div>
                  )}

                  {/* ONE Single Action Button */}
                  {!isConversationalActive ? (
                    <button
                      type="button"
                      onClick={startConversationalMode}
                      className="w-full h-12 rounded-xl text-xs font-semibold bg-gradient-to-r from-[#8B5CF6] to-[#7C3AED] hover:from-[#7C3AED] hover:to-[#6D28D9] text-white shadow-[0_0_24px_rgba(139,92,246,0.35)] flex items-center justify-center gap-2.5 transition-[transform,box-shadow] duration-150 ease-out active:scale-[0.98]"
                    >
                      <Radio size={16} strokeWidth={1.5} className="animate-pulse" />
                      <span>Start Conversation</span>
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={stopConversationalMode}
                      className="w-full h-11 rounded-xl text-xs font-semibold bg-rose-500/15 hover:bg-rose-500/25 text-rose-300 hover:text-rose-200 border border-rose-500/30 flex items-center justify-center gap-2 transition-[transform,background-color] duration-150 ease-out active:scale-[0.98]"
                    >
                      <Square size={13} strokeWidth={1.5} />
                      <span>End Conversation</span>
                    </button>
                  )}
                </div>
              )}

              {/* ── 4. Engine Selection Card (Unified Neutral + Violet System - Shown for Agent Mode Only) ── */}
              {agentModeType === 'agent' && (
                <div className="bg-[#141417] rounded-xl border border-white/[0.06] p-3.5 flex flex-col gap-2.5">
                  <div className="flex items-center justify-between">
                    <span className={TYPO.label}>
                      Engine
                    </span>
                    <span className={TYPO.mono}>
                      {agentSpeed === 'instant' ? '<0.1s' : '~0.4s'}
                    </span>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    {/* Gemini 3.8 Flash Card */}
                    <button
                      type="button"
                      onClick={() => handleSelectEngine('gemini')}
                      className={`p-2.5 text-left flex flex-col gap-1 ${
                        agentSpeed === 'gemini'
                          ? SURFACES.cardSelected
                          : SURFACES.cardInteractive
                      }`}
                      title="Google Gemini 3.8 Flash (Google AI Cloud)"
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-medium flex items-center gap-1.5 text-white">
                          <Sparkles size={13} strokeWidth={1.5} className={agentSpeed === 'gemini' ? 'text-[#8B5CF6]' : 'text-white/40'} />
                          Gemini 3.8
                        </span>
                        <span className={TYPO.mono}>~0.3s</span>
                      </div>
                      <div className="flex items-center justify-between text-[11px] text-white/45 leading-tight">
                        <span>Flash · Fast</span>
                        {keyStatuses.gemini && <span className={STATUS_DOTS.success} title="Key Configured" />}
                      </div>
                    </button>



                    {/* Grok 4.7 Card */}
                    <button
                      type="button"
                      onClick={() => handleSelectEngine('grok')}
                      className={`p-2.5 text-left flex flex-col gap-1 ${
                        agentSpeed === 'grok'
                          ? SURFACES.cardSelected
                          : SURFACES.cardInteractive
                      }`}
                      title="xAI Grok 4.7 Flagship Intelligence (Cloud)"
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-medium flex items-center gap-1.5 text-white">
                          <Sparkles size={13} strokeWidth={1.5} className={agentSpeed === 'grok' ? 'text-[#8B5CF6]' : 'text-white/40'} />
                          Grok 4.7
                        </span>
                        <span className={TYPO.mono}>~0.4s</span>
                      </div>
                      <div className="flex items-center justify-between text-[11px] text-white/45 leading-tight">
                        <span>xAI Cloud</span>
                        {keyStatuses.grok && <span className={STATUS_DOTS.success} title="Key Configured" />}
                      </div>
                    </button>
                  </div>

                  {/* Instant Engine Card */}
                  <button
                    type="button"
                    onClick={() => handleSelectEngine('instant')}
                    className={`p-2.5 flex items-center justify-between ${
                      agentSpeed === 'instant'
                        ? SURFACES.cardSelected
                        : SURFACES.cardInteractive
                    }`}
                    title="Instantaneous response (< 0.1s) with local knowledge engine & real-time tools"
                  >
                    <div className="flex items-center gap-2">
                      <Zap size={13} strokeWidth={1.5} className={agentSpeed === 'instant' ? 'text-[#8B5CF6]' : 'text-white/40'} />
                      <span className="text-xs font-medium text-white">Fast Local Engine</span>
                      <span className="text-[11px] text-white/40">Wikipedia + Math</span>
                    </div>
                    <span className={TYPO.mono}>&lt;0.1s</span>
                  </button>
                </div>
              )}

              {/* ── 5. Dominant Primary Action (Speak to Assistant - Shown for Agent & Repeat modes) ── */}
              {agentModeType !== 'conversational' && (
                <button
                  type="button"
                  onClick={toggleMic}
                  className={`w-full h-12 rounded-xl text-xs font-semibold flex items-center justify-center gap-2.5 transition-[transform,filter,background-color,box-shadow] duration-150 ease-out active:scale-[0.98] relative overflow-hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8B5CF6]/60 focus-visible:ring-offset-1 focus-visible:ring-offset-[#0F0F12] ${
                    isListening
                      ? 'bg-rose-500 hover:bg-rose-600 text-white shadow-[0_0_24px_rgba(244,63,94,0.4)]'
                      : BUTTONS.primary
                  }`}
                >
                  {isListening ? (
                    <>
                      <span className="relative flex h-2.5 w-2.5">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white opacity-75" />
                        <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-white" />
                      </span>
                      <MicOff size={16} strokeWidth={1.5} />
                      <span>Listening... Speak Now</span>
                    </>
                  ) : (
                    <>
                      <Mic size={16} strokeWidth={1.5} />
                      <span>Speak to Assistant</span>
                    </>
                  )}
                </button>
              )}

              {/* ── 6. AI Command Composer Card & 7. Dashboard (Hidden in Conversational Mode for minimalist orb experience) ── */}
              {agentModeType !== 'conversational' && (
                <>
                  <div className="bg-[#141417] rounded-xl border border-white/[0.06] p-3.5 flex flex-col gap-2.5">
                    <div className="flex items-center justify-between">
                      <span className={TYPO.label}>
                        Prompt / Instructions
                      </span>
                      {scriptText && (
                        <button
                          type="button"
                          onClick={() => setScriptText('')}
                          className="text-[11px] text-white/40 hover:text-white/80 transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/20 rounded px-1.5 py-0.5"
                        >
                          Clear
                        </button>
                      )}
                    </div>

                    {/* Composer Box */}
                    <div className="bg-[#0A0A0C] border border-white/[0.08] focus-within:border-[#8B5CF6]/60 focus-within:ring-1 focus-within:ring-[#8B5CF6]/30 rounded-xl p-3 flex flex-col gap-2 transition-[border-color,box-shadow] duration-150 ease-out">
                      <textarea
                        value={scriptText}
                        onChange={(e) => setScriptText(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && !e.shiftKey) {
                            e.preventDefault();
                            if (scriptText.trim() && playbackState !== 'loading') {
                              stopListening();
                              if (agentModeType === 'repeat') {
                                speakAndSync(scriptText, true);
                              } else {
                                handleAskAgent(scriptText);
                              }
                            }
                          }
                        }}
                        placeholder={agentModeType === 'repeat' ? 'Type text to speak instantly...' : 'Ask anything...'}
                        rows={3}
                        className="w-full bg-transparent text-white text-xs leading-relaxed resize-none focus:outline-none placeholder:text-white/30 custom-scrollbar"
                      />

                      {/* Internal Composer Toolbar */}
                      <div className="flex items-center justify-between pt-2 border-t border-white/[0.04]">
                        <span className="text-[11px] text-white/40 font-mono flex items-center gap-1">
                          <span>Enter</span>
                          <CornerDownLeft size={10} strokeWidth={1.5} />
                          <span>{agentModeType === 'repeat' ? 'to speak' : 'to ask'}</span>
                        </span>

                        <div className="flex items-center gap-1.5">
                          {/* Speech Direct Play/Stop Controls */}
                          {playbackState === 'playing' ? (
                            <button
                              type="button"
                              onClick={handlePlay}
                              className="w-7 h-7 rounded-lg bg-white/[0.04] hover:bg-white/[0.08] text-white flex items-center justify-center transition-[transform,background-color] duration-150 ease-out active:scale-[0.98] focus-visible:ring-1 focus-visible:ring-[#8B5CF6]/50"
                              title="Pause Speech"
                            >
                              <Pause size={13} strokeWidth={1.5} />
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={handlePlay}
                              disabled={!scriptText.trim()}
                              className="w-7 h-7 rounded-lg bg-white/[0.04] hover:bg-white/[0.08] disabled:opacity-30 text-white/70 hover:text-white flex items-center justify-center transition-[transform,background-color,color] duration-150 ease-out active:scale-[0.98] focus-visible:ring-1 focus-visible:ring-[#8B5CF6]/50"
                              title="Play Text Directly"
                            >
                              <Play size={13} strokeWidth={1.5} />
                            </button>
                          )}

                          <button
                            type="button"
                            onClick={handleStop}
                            className="w-7 h-7 rounded-lg bg-transparent hover:bg-white/[0.04] text-white/40 hover:text-white/80 flex items-center justify-center transition-[transform,background-color,color] duration-150 ease-out active:scale-[0.98] focus-visible:ring-1 focus-visible:ring-[#8B5CF6]/50"
                            title="Stop Audio"
                          >
                            <Square size={12} strokeWidth={1.5} />
                          </button>

                          {/* Action Button */}
                          <button
                            type="button"
                            onClick={() => {
                              if (scriptText.trim() && playbackState !== 'loading') {
                                stopListening();
                                if (agentModeType === 'repeat') {
                                speakAndSync(scriptText, true);
                              } else {
                                handleAskAgent(scriptText);
                              }
                            }
                          }}
                          disabled={!scriptText.trim() || playbackState === 'loading'}
                          className={`h-7 px-3 rounded-lg text-[11px] font-medium flex items-center justify-center gap-1.5 transition-[transform,filter,opacity] duration-150 ease-out active:scale-[0.98] disabled:opacity-30 disabled:cursor-not-allowed ${
                            scriptText.trim()
                              ? 'bg-gradient-to-r from-[#8B5CF6] to-[#7C3AED] hover:brightness-110 text-white shadow-[0_1px_8px_rgba(139,92,246,0.25)]'
                              : 'bg-white/[0.04] text-white/50 border border-white/[0.06]'
                          }`}
                        >
                          {playbackState === 'loading' ? (
                            <Loader2 size={13} strokeWidth={1.5} className="animate-spin" />
                          ) : (
                            <>
                              <span>{agentModeType === 'repeat' ? 'Speak' : 'Send'}</span>
                              {agentModeType === 'repeat' ? (
                                <Volume2 size={12} strokeWidth={1.5} />
                              ) : (
                                <Send size={11} strokeWidth={1.5} />
                              )}
                            </>
                          )}
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Quick Action Pills Toolbar */}
                  <div className="flex flex-wrap gap-1.5 pt-0.5">
                    {[
                      { label: 'Files', icon: Folder, prompt: 'List files in my project' },
                      { label: 'System', icon: HardDrive, prompt: 'Check system resources' },
                      { label: 'Tasks', icon: CheckSquare, prompt: 'What are my tasks?' },
                      { label: 'Memory', icon: Brain, prompt: 'What do you remember about me?' },
                      { label: 'Help', icon: HelpCircle, prompt: 'What can you do for me?' }
                    ].map((pill, i) => {
                      const IconComp = pill.icon;
                      return (
                        <button
                          key={i}
                          type="button"
                          onClick={() => handleQuickAction(pill.prompt)}
                          className="px-2.5 py-1 rounded-lg bg-[#0A0A0C] hover:bg-[#161619] border border-white/[0.06] hover:border-white/[0.12] text-white/60 hover:text-white text-[11px] font-medium flex items-center gap-1.5 transition-[background-color,border-color,color,transform] duration-150 ease-out active:scale-[0.98] focus-visible:ring-1 focus-visible:ring-[#8B5CF6]/50"
                        >
                          <IconComp size={11} strokeWidth={1.5} className="text-white/40" />
                          <span>{pill.label}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* ── 7. Assistant Technical Status Dashboard Card ── */}
                <div className="bg-[#141417] border border-white/[0.06] rounded-xl p-3.5 flex flex-col gap-2">
                  <div className="flex items-center justify-between">
                    <span className={TYPO.label}>
                      Active AI Engine
                    </span>
                    <span className="text-[11px] font-medium text-white flex items-center gap-1.5">
                      <Sparkles size={11} strokeWidth={1.5} className="text-[#8B5CF6]" />
                      {activeEngineLabel}
                    </span>
                  </div>

                  <div className="flex flex-wrap items-center gap-1.5 pt-1.5 border-t border-white/[0.04]">
                    <span className={`px-2 py-0.5 rounded-lg border text-[10px] font-medium flex items-center gap-1.5 ${
                      agentSpeed === 'instant' || (agentSpeed === 'gemini' && keyStatuses.gemini) || (agentSpeed === 'grok' && keyStatuses.grok)
                        ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400'
                        : 'bg-amber-500/10 border-amber-500/20 text-amber-400'
                    }`}>
                      <span className={`w-1.5 h-1.5 rounded-full ${
                        agentSpeed === 'instant' || (agentSpeed === 'gemini' && keyStatuses.gemini) || (agentSpeed === 'grok' && keyStatuses.grok)
                          ? 'bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.8)]'
                          : 'bg-amber-400 shadow-[0_0_6px_rgba(251,191,36,0.8)]'
                      }`} />
                      <span>
                        {agentSpeed === 'instant'
                          ? 'Local Engine'
                          : (agentSpeed === 'gemini' && keyStatuses.gemini) || (agentSpeed === 'grok' && keyStatuses.grok)
                          ? 'Cloud Connected'
                          : 'Key Needed'}
                      </span>
                    </span>
                    <span className="px-2 py-0.5 rounded-lg bg-[#0A0A0C] border border-white/[0.04] text-white/60 text-[10px]">
                      Memory Ready
                    </span>
                    <span className="px-2 py-0.5 rounded-lg bg-[#0A0A0C] border border-white/[0.04] text-white/60 text-[10px]">
                      {agentHealthInfo.toolsCount} Tools
                    </span>
                    <span className="px-2 py-0.5 rounded-lg bg-[#0A0A0C] border border-white/[0.04] text-white/60 text-[10px]">
                      Voice Ready
                    </span>
                  </div>
                </div>
              </>
            )}
            </>
          )}

          {/* ══════════════════════════════════════════════════════════════ */}
          {/* TAB 2: STUDIO & CONFIG (Secondary controls one click away)  */}
          {/* ══════════════════════════════════════════════════════════════ */}
          {activeNavTab === 'studio' && (
            <>
              {/* ── 8. Studio & Camera Card ── */}
              <div className="bg-[#141417] rounded-xl border border-white/[0.06] p-4 flex flex-col gap-3">
                <div className="flex items-center justify-between">
                  <span className={TYPO.label}>
                    Studio & Camera
                  </span>
                  <label className="text-[11px] text-[#8B5CF6] hover:text-white cursor-pointer transition-colors flex items-center gap-1 focus-within:ring-1 focus-within:ring-[#8B5CF6]/50 rounded px-1.5 py-0.5">
                    <Upload size={11} strokeWidth={1.5} />
                    <span>Upload GLB</span>
                    <input
                      type="file"
                      accept=".glb,.gltf"
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) {
                          const url = URL.createObjectURL(file);
                          setCustomGlbUrl(url);
                          setSceneTheme('custom_glb');
                        }
                      }}
                    />
                  </label>
                </div>

                {/* Camera View Presets */}
                <div className="grid grid-cols-2 gap-1.5 p-1 bg-[#0A0A0C] border border-white/[0.04] rounded-xl">
                  <button
                    type="button"
                    onClick={() => setActiveCamera('wide')}
                    className={`py-1.5 px-2 rounded-lg text-xs font-medium transition-[transform,background-color,color] duration-150 ease-out flex items-center justify-center gap-1.5 active:scale-[0.98] ${
                      activeCamera === 'wide'
                        ? 'bg-gradient-to-r from-[#8B5CF6] to-[#7C3AED] text-white shadow-[0_1px_8px_rgba(139,92,246,0.3)]'
                        : 'text-white/50 hover:text-white hover:bg-white/[0.04]'
                    }`}
                  >
                    <Maximize2 size={12} strokeWidth={1.5} />
                    <span>Studio Wide</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveCamera('closeup')}
                    className={`py-1.5 px-2 rounded-lg text-xs font-medium transition-[transform,background-color,color] duration-150 ease-out flex items-center justify-center gap-1.5 active:scale-[0.98] ${
                      activeCamera === 'closeup'
                        ? 'bg-gradient-to-r from-[#8B5CF6] to-[#7C3AED] text-white shadow-[0_1px_8px_rgba(139,92,246,0.3)]'
                        : 'text-white/50 hover:text-white hover:bg-white/[0.04]'
                    }`}
                  >
                    <Focus size={12} strokeWidth={1.5} />
                    <span>Close-up</span>
                  </button>
                </div>

                {/* Background Theme Switcher */}
                <div className="grid grid-cols-2 gap-1.5 p-1 bg-[#0A0A0C] border border-white/[0.04] rounded-xl">
                  <button
                    type="button"
                    onClick={() => setSceneTheme('creator_loft')}
                    className={`py-1.5 px-2 rounded-lg text-xs font-medium transition-[transform,background-color,color] duration-150 ease-out flex items-center justify-center gap-1.5 active:scale-[0.98] ${
                      sceneTheme === 'creator_loft'
                        ? 'bg-white/[0.08] text-white font-semibold shadow-sm'
                        : 'text-white/50 hover:text-white hover:bg-white/[0.04]'
                    }`}
                  >
                    <Coffee size={12} strokeWidth={1.5} />
                    <span>Creator Loft</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setSceneTheme('broadcast_studio')}
                    className={`py-1.5 px-2 rounded-lg text-xs font-medium transition-[transform,background-color,color] duration-150 ease-out flex items-center justify-center gap-1.5 active:scale-[0.98] ${
                      sceneTheme === 'broadcast_studio'
                        ? 'bg-white/[0.08] text-white font-semibold shadow-sm'
                        : 'text-white/50 hover:text-white hover:bg-white/[0.04]'
                    }`}
                  >
                    <Tv size={12} strokeWidth={1.5} />
                    <span>News Studio</span>
                  </button>
                </div>
              </div>

              {/* ── 9. Voice Packs Card ── */}
              <div className="bg-[#141417] rounded-xl border border-white/[0.06] p-4 flex flex-col gap-3">
                <div className="flex items-center justify-between">
                  <span className={TYPO.label}>
                    Voice Packs
                  </span>
                  <button
                    type="button"
                    onClick={handlePreviewVoice}
                    className="text-[11px] px-2.5 py-1 rounded-lg bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.08] text-white/70 hover:text-white transition-[transform,background-color,color] duration-150 ease-out flex items-center gap-1 active:scale-[0.98]"
                  >
                    <Play size={10} strokeWidth={1.5} />
                    <span>Preview Voice</span>
                  </button>
                </div>

                {/* Category Filter Pills */}
                <div className="flex items-center gap-1.5 overflow-x-auto custom-scrollbar pb-0.5">
                  {[
                    { id: 'all', label: 'All', count: voices.length },
                    { id: 'azure', label: 'Neural HD', count: voices.filter(v => v.backend === 'azure').length },
                    { id: 'elevenlabs', label: 'ElevenLabs', count: voices.filter(v => v.backend === 'elevenlabs').length },
                    { id: 'webSpeech', label: 'Local', count: voices.filter(v => v.backend === 'webSpeech').length },
                  ].map(tab => (
                    <button
                      key={tab.id}
                      type="button"
                      onClick={() => setVoiceFilterTab(tab.id as any)}
                      className={`px-2 py-0.5 rounded-md text-[10px] font-medium transition-colors ${
                        voiceFilterTab === tab.id
                          ? 'bg-[#8B5CF6]/25 text-[#A78BFA] border border-[#8B5CF6]/40'
                          : 'text-white/50 hover:text-white/80 hover:bg-white/[0.04]'
                      }`}
                    >
                      {tab.label} ({tab.count})
                    </button>
                  ))}
                </div>

                <div className="grid grid-cols-2 gap-2 max-h-52 overflow-y-auto custom-scrollbar pr-1">
                  {(voiceFilterTab === 'all' ? voices : voices.filter(v => v.backend === voiceFilterTab)).map((v) => {
                    const isSelected = v.id === selectedVoice;
                    return (
                      <button
                        key={v.id}
                        type="button"
                        onClick={() => {
                          setSelectedVoice(v.id);
                          if (typeof window !== 'undefined') {
                            try { localStorage.setItem('talking_character_selected_voice', v.id); } catch {}
                          }
                          voiceManager.playPreview(v);
                        }}
                        className={`p-2.5 rounded-xl text-left transition-[transform,border-color,background-color,box-shadow] duration-150 ease-out border flex flex-col gap-1 active:scale-[0.98] ${
                          isSelected
                            ? 'bg-[#101013] border-[#8B5CF6]/70 ring-1 ring-[#8B5CF6]/50 shadow-[0_0_16px_rgba(139,92,246,0.18)] text-white'
                            : 'bg-[#101013] border-white/[0.06] hover:border-white/[0.12] text-white/70 hover:text-white'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <span className={`text-xs font-medium truncate ${isSelected ? 'text-white' : 'text-white/80'}`}>
                            {v.name.replace(/\(ElevenLabs\)|\(Neural\)|\(Female\)/g, '').trim()}
                          </span>
                          <Volume2 size={12} strokeWidth={1.5} className={isSelected ? 'text-[#8B5CF6]' : 'text-white/40'} />
                        </div>
                        <div className="flex items-center justify-between text-[10px] text-white/40">
                          <span>{v.backend === 'elevenlabs' ? 'ElevenLabs' : v.backend === 'azure' ? 'Neural HD' : 'Local'}</span>
                          {isSelected && <span className={STATUS_DOTS.hero} />}
                        </div>
                      </button>
                    );
                  })}
                </div>

                {/* ── 9b. Lip-Sync Latency & Calibration ── */}
                <div className="p-3 rounded-xl bg-[#0A0A0C] border border-white/[0.06] flex flex-col gap-2 mt-1">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                      <Sliders size={12} strokeWidth={1.5} className="text-[#8B5CF6]" />
                      <span className="text-[11px] font-medium text-white">
                        Lip-Sync Calibration
                      </span>
                    </div>
                    <span className="text-[10px] font-mono text-white/60 bg-white/[0.04] px-2 py-0.5 rounded-lg border border-white/[0.06]">
                      {lipSyncDelayMs > 0 ? `+${lipSyncDelayMs}ms delay` : `${lipSyncDelayMs}ms`}
                    </span>
                  </div>

                  <p className="text-[11px] text-white/50 leading-relaxed">
                    Adjusts mouth-to-audio sync offset for speakers or Bluetooth headphones.
                  </p>

                  <div className="flex items-center gap-2 pt-0.5">
                    <span className="text-[10px] text-white/40 font-mono whitespace-nowrap">-50ms</span>
                    <input
                      type="range"
                      min="-50"
                      max="350"
                      step="10"
                      value={lipSyncDelayMs}
                      onChange={(e) => setLipSyncDelayMs(Number(e.target.value))}
                      className={FORMS.range}
                    />
                    <span className="text-[10px] text-white/40 font-mono whitespace-nowrap">+350ms</span>
                  </div>

                  {/* Quick Presets */}
                  <div className="grid grid-cols-3 gap-1.5 pt-0.5">
                    <button
                      type="button"
                      onClick={() => setLipSyncDelayMs(120)}
                      className={`py-1 px-1.5 rounded-lg text-[10px] font-mono border text-center transition-[transform,background-color,border-color,color] duration-150 ease-out active:scale-[0.98] ${
                        lipSyncDelayMs === 120
                          ? 'bg-[#8B5CF6]/20 border-[#8B5CF6]/50 text-white font-medium'
                          : 'bg-[#141417] border-white/[0.04] text-white/60 hover:text-white'
                      }`}
                      title="Optimal sync for built-in laptop and monitor speakers"
                    >
                      Standard (120ms)
                    </button>
                    <button
                      type="button"
                      onClick={() => setLipSyncDelayMs(200)}
                      className={`py-1 px-1.5 rounded-lg text-[10px] font-mono border text-center transition-[transform,background-color,border-color,color] duration-150 ease-out active:scale-[0.98] ${
                        lipSyncDelayMs === 200
                          ? 'bg-[#8B5CF6]/20 border-[#8B5CF6]/50 text-white font-medium'
                          : 'bg-[#141417] border-white/[0.04] text-white/60 hover:text-white'
                      }`}
                      title="Compensates for extra Bluetooth headphone latency"
                    >
                      Bluetooth (200ms)
                    </button>
                    <button
                      type="button"
                      onClick={() => setLipSyncDelayMs(0)}
                      className={`py-1 px-1.5 rounded-lg text-[10px] font-mono border text-center transition-[transform,background-color,border-color,color] duration-150 ease-out active:scale-[0.98] ${
                        lipSyncDelayMs === 0
                          ? 'bg-[#8B5CF6]/20 border-[#8B5CF6]/50 text-white font-medium'
                          : 'bg-[#141417] border-white/[0.04] text-white/60 hover:text-white'
                      }`}
                      title="Direct 0ms offset"
                    >
                      Direct (0ms)
                    </button>
                  </div>
                </div>
              </div>

              {/* ── 10. Conversations & History Card ── */}
              <div className="bg-[#141417] rounded-xl border border-white/[0.06] p-4 flex flex-col gap-2.5">
                <div className="flex items-center justify-between">
                  <span className={TYPO.label}>
                    Conversations
                  </span>
                  <span className={TYPO.mono}>Local History</span>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setIsHistoryModalOpen(true)}
                    className={`flex-1 h-9 px-3 ${BUTTONS.secondary} flex items-center justify-center gap-2 text-xs`}
                  >
                    <History size={13} strokeWidth={1.5} className="text-[#8B5CF6]" />
                    <span>Open History</span>
                  </button>

                  <button
                    type="button"
                    onClick={async () => {
                      await clearAgentHistory();
                      setHistoryClearedToast(true);
                      setTimeout(() => setHistoryClearedToast(false), 2500);
                    }}
                    className={`h-9 px-3 ${BUTTONS.destructive} text-xs flex items-center justify-center gap-1.5`}
                    title="Clear conversation history"
                  >
                    <Trash2 size={13} strokeWidth={1.5} />
                    {historyClearedToast ? <span className="text-[10px] font-medium text-rose-400">Cleared</span> : null}
                  </button>
                </div>
              </div>

              {/* ── 11. Cloud & AI API Keys (Accordion) ── */}
              <div className="bg-[#141417] rounded-xl border border-white/[0.06] p-4 flex flex-col gap-2.5">
                <button
                  type="button"
                  onClick={() => setShowKeyConfig(!showKeyConfig)}
                  className="w-full flex items-center justify-between text-left group"
                >
                  <div className="flex items-center gap-2">
                    <Key size={13} strokeWidth={1.5} className="text-[#8B5CF6]" />
                    <span className="text-xs font-medium text-white group-hover:text-white transition-colors">
                      Cloud & AI API Keys
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5 text-white/40 group-hover:text-white/70 transition-colors">
                    <span className="text-[11px] font-mono">
                      {keyStatuses.grok || keyStatuses.gemini || keyStatuses.elevenlabs ? 'Configured' : 'Optional'}
                    </span>
                    {showKeyConfig ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                  </div>
                </button>

                {showKeyConfig && (
                  <div className="mt-1 p-3 rounded-xl bg-[#0A0A0C] border border-white/[0.06] space-y-3">
                    {/* Tab Selector - Unified Neutral + Violet Indicator */}
                    <div className="flex items-center gap-1 p-1 bg-[#141417] rounded-xl border border-white/[0.04]">
                      <button
                        type="button"
                        onClick={() => setActiveKeyTab('gemini')}
                        className={`flex-1 py-1.5 text-[11px] font-medium rounded-lg transition-[background-color,color] duration-150 ease-out flex items-center justify-center gap-1.5 ${
                          activeKeyTab === 'gemini'
                            ? 'bg-white/[0.08] text-white shadow-sm'
                            : 'text-white/50 hover:text-white'
                        }`}
                      >
                        <Sparkles size={11} className={activeKeyTab === 'gemini' ? 'text-[#8B5CF6]' : 'text-white/40'} />
                        <span>Gemini</span>
                        {keyStatuses.gemini && <span className={STATUS_DOTS.success} />}
                      </button>
                      
                      <button
                        type="button"
                        onClick={() => setActiveKeyTab('grok')}
                        className={`flex-1 py-1.5 text-[11px] font-medium rounded-lg transition-[background-color,color] duration-150 ease-out flex items-center justify-center gap-1.5 ${
                          activeKeyTab === 'grok'
                            ? 'bg-white/[0.08] text-white shadow-sm'
                            : 'text-white/50 hover:text-white'
                        }`}
                      >
                        <Sparkles size={11} className={activeKeyTab === 'grok' ? 'text-[#8B5CF6]' : 'text-white/40'} />
                        <span>Grok</span>
                        {keyStatuses.grok && <span className={STATUS_DOTS.success} />}
                      </button>
                      <button
                        type="button"
                        onClick={() => setActiveKeyTab('elevenlabs')}
                        className={`flex-1 py-1.5 text-[11px] font-medium rounded-lg transition-[background-color,color] duration-150 ease-out flex items-center justify-center gap-1.5 ${
                          activeKeyTab === 'elevenlabs'
                            ? 'bg-white/[0.08] text-white shadow-sm'
                            : 'text-white/50 hover:text-white'
                        }`}
                      >
                        <Volume2 size={11} className={activeKeyTab === 'elevenlabs' ? 'text-[#8B5CF6]' : 'text-white/40'} />
                        <span>Voices</span>
                        {keyStatuses.elevenlabs && <span className={STATUS_DOTS.success} />}
                      </button>
                    </div>

                    {/* Grok Key Panel */}
                    {activeKeyTab === 'grok' && (
                      <div className="space-y-2.5">
                        <div className="flex items-center justify-between">
                          <span className={TYPO.caption}>xAI Grok API Key</span>
                          <a
                            href="https://console.x.ai/"
                            target="_blank"
                            rel="noreferrer"
                            className="text-[11px] text-[#8B5CF6] hover:text-[#A78BFA] hover:underline flex items-center gap-1 transition-colors"
                          >
                            <span>Get xAI Key</span>
                            <ExternalLink size={10} />
                          </a>
                        </div>
                        <input
                          type="password"
                          value={grokKey}
                          onChange={(e) => setGrokKey(e.target.value)}
                          placeholder="xai-..."
                          className={`w-full ${FORMS.input}`}
                        />
                        <button
                          type="button"
                          onClick={async () => {
                            if (typeof window !== 'undefined') {
                              localStorage.setItem('grok_api_key', grokKey);
                              localStorage.setItem('xai_api_key', grokKey);
                            }
                            await saveAgentApiKey('grok', grokKey);
                            setKeyStatuses(prev => ({ ...prev, grok: !!grokKey.trim() }));
                            setKeyToastMessage('Grok Key Saved!');
                            setTimeout(() => setKeyToastMessage(null), 2500);
                          }}
                          className={`w-full py-2 ${BUTTONS.primary} text-xs`}
                        >
                          {keyToastMessage || 'Save Grok Key'}
                        </button>
                      </div>
                    )}

                    {/* Gemini Key Panel */}
                    {activeKeyTab === 'gemini' && (
                      <div className="space-y-2.5">
                        <div className="flex items-center justify-between">
                          <span className={TYPO.caption}>Google Gemini Key (Free Tier)</span>
                          <a
                            href="https://aistudio.google.com/app/apikey"
                            target="_blank"
                            rel="noreferrer"
                            className="text-[11px] text-[#8B5CF6] hover:text-[#A78BFA] hover:underline flex items-center gap-1 transition-colors"
                          >
                            <span>Get Free Key</span>
                            <ExternalLink size={10} />
                          </a>
                        </div>
                        <input
                          type="password"
                          value={geminiKey}
                          onChange={(e) => setGeminiKey(e.target.value)}
                          placeholder="AIzaSy..."
                          className={`w-full ${FORMS.input}`}
                        />
                        <button
                          type="button"
                          onClick={async () => {
                            if (typeof window !== 'undefined') localStorage.setItem('gemini_api_key', geminiKey);
                            await saveAgentApiKey('gemini', geminiKey);
                            setKeyStatuses(prev => ({ ...prev, gemini: !!geminiKey.trim() }));
                            setKeyToastMessage('Gemini Key Saved!');
                            setTimeout(() => setKeyToastMessage(null), 2500);
                          }}
                          className={`w-full py-2 ${BUTTONS.primary} text-xs`}
                        >
                          {keyToastMessage || 'Save Gemini Key'}
                        </button>
                      </div>
                    )}

                    {/* ElevenLabs Key Panel */}
                    {activeKeyTab === 'elevenlabs' && (
                      <div className="space-y-2.5">
                        <div className="flex items-center justify-between">
                          <span className={TYPO.caption}>ElevenLabs Voice Key</span>
                          <a
                            href="https://elevenlabs.io"
                            target="_blank"
                            rel="noreferrer"
                            className="text-[11px] text-[#8B5CF6] hover:text-[#A78BFA] hover:underline flex items-center gap-1 transition-colors"
                          >
                            <span>elevenlabs.io</span>
                            <ExternalLink size={10} />
                          </a>
                        </div>
                        <input
                          type="password"
                          value={elevenLabsKey}
                          onChange={(e) => setElevenLabsKey(e.target.value)}
                          placeholder="Paste xi-api-key..."
                          className={`w-full ${FORMS.input}`}
                        />
                        <button
                          type="button"
                          onClick={async () => {
                            if (typeof window !== 'undefined') localStorage.setItem('elevenlabs_api_key', elevenLabsKey);
                            await saveElevenLabsKey(elevenLabsKey);
                            setKeyStatuses(prev => ({ ...prev, elevenlabs: !!elevenLabsKey.trim() }));
                            setKeyToastMessage('Voice Key Saved!');
                            setTimeout(() => setKeyToastMessage(null), 2500);
                          }}
                          className={`w-full py-2 ${BUTTONS.primary} text-xs`}
                        >
                          {keyToastMessage || 'Save ElevenLabs Key'}
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </>
          )}

        </div>
      </aside>
    </>
  );
}
