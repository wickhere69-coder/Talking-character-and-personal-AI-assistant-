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
import { sendAgentMessage, getAgentHealth, clearAgentHistory, saveAgentApiKey, getAgentKeyStatus } from '@/services/agentService';
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
  ChevronUp
} from 'lucide-react';

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
  const [keyStatuses, setKeyStatuses] = useState<{ grok: boolean; gemini: boolean; elevenlabs: boolean }>({
    grok: false,
    gemini: false,
    elevenlabs: false
  });
  const [activeKeyTab, setActiveKeyTab] = useState<'grok' | 'gemini' | 'elevenlabs'>('grok');
  const [showKeyConfig, setShowKeyConfig] = useState(false);
  const [keyToastMessage, setKeyToastMessage] = useState<string | null>(null);
  const [historyClearedToast, setHistoryClearedToast] = useState(false);
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

  // Load voices & agent health on mount
  useEffect(() => {
    async function init() {
      const allVoices = await loadAllCuratedVoices();
      setVoices(allVoices);

      const savedVoice = typeof window !== 'undefined' ? localStorage.getItem('talking_character_selected_voice') : null;
      const validSaved = savedVoice ? allVoices.find(v => v.id === savedVoice && v.backend !== 'webSpeech') : null;
      if (validSaved) {
        setSelectedVoice(validSaved.id);
      } else if (allVoices.length > 0) {
        // Default to JennyNeural (studio HD female voice)
        const defaultVoice = allVoices.find(v => v.id === 'en-US-JennyNeural') || allVoices[0];
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
    const activeVoice = store.voices.find(v => v.id === store.selectedVoice)
      || store.voices.find(v => v.id === 'en-US-JennyNeural')
      || store.voices.find(v => v.backend === 'azure')
      || store.voices[0];
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
      const providerMapping = agentSpeed === 'instant' ? 'local_fallback' : agentSpeed;
      const res = await sendAgentMessage(trimmed, {
        mode: agentModeType,
        modelProvider: providerMapping
      });

      console.log(`[AI RESPONSE] Received response (${res.modelUsed || 'default'}): "${(res.response || '').substring(0, 80)}..."`);

      if (res.modelUsed) {
        const readableModel =
          res.modelUsed === 'grok'
            ? 'xAI Grok 4.6'
            : res.modelUsed === 'gemini'
            ? 'Google Gemini 3.8 Flash'
            : res.modelUsed === 'local_openai'
            ? 'Local OpenAI LLM'
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
        // Natural human conversation pause:
        // 1800ms on isFinal (allows taking a breath between clauses without getting cut off), 2600ms on interim.
        // In repeat practice mode: 800ms on isFinal, 1200ms on interim.
        const delay = isRepeat ? (isFinal ? 800 : 1200) : (isFinal ? 1800 : 2600);

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
    setAgentSpeed(speed);
    const readable =
      speed === 'grok'
        ? 'xAI Grok 4.6'
        : speed === 'gemini'
        ? 'Google Gemini 3.8 Flash'
        : 'Fast Instant Engine';
    setAgentModelName(readable);
  };

  const activeEngineLabel =
    agentSpeed === 'grok'
      ? 'xAI Grok 4.6'
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
              {/* ── 3. AI Mode Switcher (Segmented Control) ── */}
              <div className="bg-[#141417] rounded-xl border border-white/[0.06] p-2.5">
                <div className="grid grid-cols-2 gap-1 p-1 bg-[#0A0A0C] border border-white/[0.04] rounded-xl">
                  <button
                    type="button"
                    onClick={() => setAgentModeType('agent')}
                    className={`py-1.5 px-2 rounded-lg text-[11px] font-semibold uppercase tracking-wider transition-[transform,background-color,color,box-shadow] duration-150 ease-out flex items-center justify-center gap-1.5 active:scale-[0.98] ${
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
                    onClick={() => setAgentModeType('repeat')}
                    className={`py-1.5 px-2 rounded-lg text-[11px] font-semibold uppercase tracking-wider transition-[transform,background-color,color,box-shadow] duration-150 ease-out flex items-center justify-center gap-1.5 active:scale-[0.98] ${
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

              {/* ── 4. Engine Selection Card (Unified Neutral + Violet System) ── */}
              {agentModeType !== 'repeat' && (
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
                    {/* Grok 4.6 Card - Differentiated with label/dot, unified violet accent */}
                    <button
                      type="button"
                      onClick={() => handleSelectEngine('grok')}
                      className={`p-2.5 text-left flex flex-col gap-1 ${
                        agentSpeed === 'grok'
                          ? SURFACES.cardSelected
                          : SURFACES.cardInteractive
                      }`}
                      title="xAI Grok 4.6 Flagship Intelligence (Cloud)"
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-medium flex items-center gap-1.5 text-white">
                          <Sparkles size={13} strokeWidth={1.5} className={agentSpeed === 'grok' ? 'text-[#8B5CF6]' : 'text-white/40'} />
                          Grok 4.6
                        </span>
                        <span className={TYPO.mono}>~0.4s</span>
                      </div>
                      <div className="flex items-center justify-between text-[11px] text-white/45 leading-tight">
                        <span>xAI Cloud</span>
                        {keyStatuses.grok && <span className={STATUS_DOTS.success} title="Key Configured" />}
                      </div>
                    </button>

                    {/* Gemini Card - Differentiated with label/dot, unified violet accent */}
                    <button
                      type="button"
                      onClick={() => handleSelectEngine('gemini')}
                      className={`p-2.5 text-left flex flex-col gap-1 ${
                        agentSpeed === 'gemini'
                          ? SURFACES.cardSelected
                          : SURFACES.cardInteractive
                      }`}
                      title="Google Gemini 3.8 Flash (Cloud Free Tier)"
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-medium flex items-center gap-1.5 text-white">
                          <Sparkles size={13} strokeWidth={1.5} className={agentSpeed === 'gemini' ? 'text-[#8B5CF6]' : 'text-white/40'} />
                          Gemini
                        </span>
                        <span className={TYPO.mono}>~0.4s</span>
                      </div>
                      <div className="flex items-center justify-between text-[11px] text-white/45 leading-tight">
                        <span>3.8 Flash</span>
                        {keyStatuses.gemini && <span className={STATUS_DOTS.success} title="Key Configured" />}
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
                    title="Instantaneous response (< 0.1s) with local fast engine & real-time tools"
                  >
                    <div className="flex items-center gap-2">
                      <Zap size={13} strokeWidth={1.5} className={agentSpeed === 'instant' ? 'text-[#8B5CF6]' : 'text-white/40'} />
                      <span className="text-xs font-medium text-white">Instant Engine</span>
                      <span className="text-[11px] text-white/40">Offline rules</span>
                    </div>
                    <span className={TYPO.mono}>&lt;0.1s</span>
                  </button>
                </div>
              )}

              {/* ── 5. Dominant Primary Action (Speak to Assistant) ── */}
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

              {/* ── 6. AI Command Composer Card ── */}
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

                <div className="grid grid-cols-2 gap-2 max-h-44 overflow-y-auto custom-scrollbar pr-1">
                  {voices.map((v) => {
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
                            {v.name.replace(/\(ElevenLabs\)|\(Neural\)/g, '').trim()}
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
