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
  Bot,
  MessageSquare,
  Repeat,
  Zap,
  Cpu,
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
  Flame,
  ExternalLink,
  Sliders
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

  // Automatically clear instruction box once prompt speech completes in REPEAT mode
  useEffect(() => {
    voiceManager.setOnPlaybackEnd(() => {
      const state = useAppStore.getState();
      if (state.agentModeType === 'repeat') {
        setScriptText('');
      }
    });
    return () => {
      voiceManager.setOnPlaybackEnd(null);
    };
  }, [setScriptText]);

  const stopListening = useCallback(() => {
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

  const speakAndSync = useCallback(async (textToSpeak: string) => {
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
    await voiceManager.speak(cleaned, activeVoice, key);
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

    let stepTimer: any = null;
    // Multi-step task display placeholder for tool queries
    if (agentModeType === 'agent') {
      setActiveTaskSteps([
        { title: 'Analyze user prompt', status: 'in_progress' },
        { title: 'Evaluate local capabilities & tools', status: 'pending' },
        { title: 'Synthesize spoken response', status: 'pending' }
      ]);

      let stepCounter = 0;
      stepTimer = setInterval(() => {
        stepCounter++;
        if (stepCounter === 1) {
          setActiveTaskSteps([
            { title: 'Analyze user prompt', status: 'completed' },
            { title: 'Evaluate local capabilities & tools', status: 'in_progress' },
            { title: 'Synthesize spoken response', status: 'pending' }
          ]);
        } else if (stepCounter === 2) {
          setActiveTaskSteps([
            { title: 'Analyze user prompt', status: 'completed' },
            { title: 'Evaluate local capabilities & tools', status: 'completed' },
            { title: 'Synthesize spoken response', status: 'in_progress' }
          ]);
        }
      }, 250);
    }

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
      if (stepTimer) clearInterval(stepTimer);
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
        // Ultra-fast responsiveness: 120ms on isFinal in repeat mode (near-instantaneous!), 350ms on interim pause.
        const delay = isRepeat ? (isFinal ? 120 : 350) : (isFinal ? 250 : 650);

        silenceTimerRef.current = setTimeout(async () => {
          stopListening();
          const toProcess = accumulated.trim();
          accumulated = '';
          if (toProcess) {
            if (isRepeat) {
              await speakAndSync(toProcess);
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
      speakAndSync(scriptText);
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

  return (
    <>
      {/* Refined Sidebar Toggle when collapsed */}
      {isCollapsed && (
        <button
          type="button"
          onClick={() => setIsCollapsed(false)}
          className="fixed top-5 right-5 z-50 p-2.5 rounded-xl bg-[#151518]/90 hover:bg-[#1A1A1F] backdrop-blur-xl border border-white/[0.08] text-[#F5F5F7] shadow-2xl transition-all duration-200 flex items-center gap-2 text-xs font-medium"
          title="Open Studio AI Agent Panel"
        >
          <PanelRightOpen size={16} strokeWidth={1.5} className="text-[#8B5CF6]" />
          <span>Assistant</span>
        </button>
      )}

      {/* Main Floating Application Panel - Solid Dark Layer (No GPU blur flicker) */}
      <aside 
        aria-label="Studio AI Agent Control Panel"
        className={`fixed right-5 top-5 bottom-5 w-[370px] max-md:w-[92vw] max-md:right-[4vw] z-40 transition-transform transition-opacity duration-300 transform-gpu pointer-events-auto ${
          isCollapsed ? 'translate-x-[400px] opacity-0 pointer-events-none' : 'translate-x-0 opacity-100'
        }`}
      >
        <div className="h-full bg-[#111113] border border-white/[0.08] rounded-2xl shadow-[0_24px_48px_rgba(0,0,0,0.65)] p-5 flex flex-col gap-4 overflow-y-auto custom-scrollbar">

          {/* ── 1. Header ── */}
          <div className="flex items-center justify-between pb-3 border-b border-white/[0.06]">
            <div className="flex flex-col">
              <h1 className="text-[15px] font-semibold text-[#F5F5F7] tracking-tight">
                STUDIO AI AGENT
              </h1>
              <span className="text-[12px] text-[#9898A3] font-normal">
                Local Digital Personal Assistant
              </span>
            </div>

            <div className="flex items-center gap-2.5">
              <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[#1A1A1F] border border-white/[0.06] text-[10px] text-[#9898A3] font-medium tracking-wide">
                <span className={`w-1.5 h-1.5 rounded-full ${agentHealthInfo.connected ? 'bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.6)]' : 'bg-rose-400'}`} />
                <span>{agentHealthInfo.connected ? 'CONNECTED' : 'OFFLINE'}</span>
              </div>

              <button
                type="button"
                onClick={() => setIsCollapsed(true)}
                className="w-7 h-7 rounded-lg flex items-center justify-center text-[#9898A3] hover:text-[#F5F5F7] hover:bg-white/[0.06] transition-colors"
                title="Minimize Panel"
              >
                <X size={15} strokeWidth={1.5} />
              </button>
            </div>
          </div>

          {/* ── 2. AI Mode Switcher (Segmented Control) ── */}
          <div className="flex flex-col gap-1.5">
            <div className="grid grid-cols-3 gap-1 p-1 bg-[#1A1A1F] border border-white/[0.06] rounded-xl">
              <button
                type="button"
                onClick={() => setAgentModeType('agent')}
                className={`py-2 px-2 rounded-lg text-[11px] font-medium transition-all flex items-center justify-center gap-1.5 ${
                  agentModeType === 'agent'
                    ? 'bg-gradient-to-r from-[#7C3AED] to-[#6D28D9] text-[#F5F5F7] shadow-sm'
                    : 'text-[#9898A3] hover:text-[#F5F5F7] hover:bg-white/[0.02]'
                }`}
                title="Full agent mode: reasoning, memory, and local tool execution"
              >
                <Bot size={13} strokeWidth={1.5} />
                <span>AGENT</span>
              </button>
              <button
                type="button"
                onClick={() => setAgentModeType('chat')}
                className={`py-2 px-2 rounded-lg text-[11px] font-medium transition-all flex items-center justify-center gap-1.5 ${
                  agentModeType === 'chat'
                    ? 'bg-gradient-to-r from-[#7C3AED] to-[#6D28D9] text-[#F5F5F7] shadow-sm'
                    : 'text-[#9898A3] hover:text-[#F5F5F7] hover:bg-white/[0.02]'
                }`}
                title="Fast conversational assistant (tools disabled)"
              >
                <MessageSquare size={13} strokeWidth={1.5} />
                <span>CHAT</span>
              </button>
              <button
                type="button"
                onClick={() => setAgentModeType('repeat')}
                className={`py-2 px-2 rounded-lg text-[11px] font-medium transition-all flex items-center justify-center gap-1.5 ${
                  agentModeType === 'repeat'
                    ? 'bg-gradient-to-r from-[#7C3AED] to-[#6D28D9] text-[#F5F5F7] shadow-sm'
                    : 'text-[#9898A3] hover:text-[#F5F5F7] hover:bg-white/[0.02]'
                }`}
                title="Direct speech synthesis & voice repeat"
              >
                <Repeat size={13} strokeWidth={1.5} />
                <span>REPEAT</span>
              </button>
            </div>
          </div>

          {/* ── 3. Engine Selection (Grok 4.6, Gemini 3.8, Instant) ── */}
          {agentModeType !== 'repeat' && (
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-medium text-[#686873] uppercase tracking-wider">
                  Engine
                </span>
                <span className="text-[10px] text-[#9898A3] font-mono">
                  {agentSpeed === 'instant' ? '<0.1s' : '~0.4s'}
                </span>
              </div>

              <div className="grid grid-cols-2 gap-2">
                {/* Grok 4.6 Cloud */}
                <button
                  type="button"
                  onClick={() => setAgentSpeed('grok')}
                  className={`p-2.5 rounded-xl border text-left transition-all flex flex-col gap-1 ${
                    agentSpeed === 'grok'
                      ? 'bg-[#1A1A1F] border-cyan-500/70 text-[#F5F5F7] shadow-[0_0_15px_rgba(6,182,212,0.15)]'
                      : 'bg-[#1A1A1F]/60 border-white/[0.05] text-[#9898A3] hover:border-white/[0.1] hover:text-[#F5F5F7]'
                  }`}
                  title="xAI Grok 4.6 Flagship Intelligence (Cloud)"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium flex items-center gap-1.5 text-[#F5F5F7]">
                      <Sparkles size={13} strokeWidth={1.5} className={agentSpeed === 'grok' ? 'text-cyan-400' : 'text-[#686873]'} />
                      Grok 4.6
                    </span>
                    <span className="text-[10px] text-cyan-400/90 font-mono">~0.4s</span>
                  </div>
                  <div className="flex items-center justify-between text-[10px] text-[#686873] leading-tight">
                    <span>xAI Flagship</span>
                    {keyStatuses.grok && <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.8)]" title="Key Configured" />}
                  </div>
                </button>

                {/* Gemini Cloud */}
                <button
                  type="button"
                  onClick={() => setAgentSpeed('gemini')}
                  className={`p-2.5 rounded-xl border text-left transition-all flex flex-col gap-1 ${
                    agentSpeed === 'gemini'
                      ? 'bg-[#1A1A1F] border-[#7C3AED]/70 text-[#F5F5F7] shadow-[0_0_15px_rgba(124,58,237,0.15)]'
                      : 'bg-[#1A1A1F]/60 border-white/[0.05] text-[#9898A3] hover:border-white/[0.1] hover:text-[#F5F5F7]'
                  }`}
                  title="Google Gemini 3.8 Flash (Latest Cloud Free Tier)"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium flex items-center gap-1.5 text-[#F5F5F7]">
                      <Sparkles size={13} strokeWidth={1.5} className={agentSpeed === 'gemini' ? 'text-[#8B5CF6]' : 'text-[#686873]'} />
                      Gemini
                    </span>
                    <span className="text-[10px] text-[#8B5CF6] font-mono">~0.4s</span>
                  </div>
                  <div className="flex items-center justify-between text-[10px] text-[#686873] leading-tight">
                    <span>Gemini 3.8 Flash</span>
                    {keyStatuses.gemini && <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.8)]" title="Key Configured" />}
                  </div>
                </button>
              </div>

              {/* Instant Engine */}
              <button
                type="button"
                onClick={() => setAgentSpeed('instant')}
                className={`p-2 rounded-xl border text-left transition-all flex items-center justify-between ${
                  agentSpeed === 'instant'
                    ? 'bg-[#1A1A1F] border-[#7C3AED]/70 text-[#F5F5F7] shadow-[0_0_15px_rgba(124,58,237,0.15)]'
                    : 'bg-[#1A1A1F]/60 border-white/[0.05] text-[#9898A3] hover:border-white/[0.1] hover:text-[#F5F5F7]'
                }`}
                title="Instantaneous response (< 0.1s) with local fast engine & real-time tools"
              >
                <div className="flex items-center gap-2">
                  <Zap size={13} strokeWidth={1.5} className={agentSpeed === 'instant' ? 'text-[#8B5CF6]' : 'text-[#686873]'} />
                  <span className="text-xs font-medium text-[#F5F5F7]">Instant Engine</span>
                  <span className="text-[10px] text-[#686873]">Fast offline rule engine</span>
                </div>
                <span className="text-[10px] text-[#686873] font-mono">&lt;0.1s</span>
              </button>
            </div>
          )}

          {/* ── 4. Primary Action (Dominant Speak to Assistant) ── */}
          <button
            type="button"
            onClick={toggleMic}
            className={`w-full h-12 rounded-xl text-xs font-semibold flex items-center justify-center gap-2.5 transition-all active:scale-[0.99] ${
              isListening
                ? 'bg-rose-500 hover:bg-rose-600 text-white shadow-[0_0_20px_rgba(244,63,94,0.35)]'
                : 'bg-gradient-to-r from-[#7C3AED] to-[#6D28D9] hover:from-[#8B5CF6] hover:to-[#7C3AED] text-white shadow-[0_4px_20px_rgba(124,58,237,0.25)]'
            }`}
          >
            {isListening ? (
              <>
                <span className="w-2 h-2 rounded-full bg-white shadow-[0_0_8px_rgba(255,255,255,0.9)]" />
                <MicOff size={17} strokeWidth={1.5} />
                <span>Listening... Speak Now</span>
              </>
            ) : (
              <>
                <Mic size={17} strokeWidth={1.5} />
                <span>Speak to Assistant</span>
              </>
            )}
          </button>

          {/* ── 5. Modern AI Command Composer ── */}
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-medium text-[#686873] uppercase tracking-wider">
                Prompt / Instructions
              </span>
              {scriptText && (
                <button
                  type="button"
                  onClick={() => setScriptText('')}
                  className="text-[10px] text-[#686873] hover:text-[#9898A3] transition-colors"
                >
                  Clear
                </button>
              )}
            </div>

            {/* Composer Box */}
            <div className="bg-[#1A1A1F] border border-white/[0.08] focus-within:border-[#7C3AED]/70 rounded-xl p-3 flex flex-col gap-2.5 transition-all shadow-inner">
              <textarea
                value={scriptText}
                onChange={(e) => setScriptText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    if (scriptText.trim() && playbackState !== 'loading') {
                      stopListening();
                      if (agentModeType === 'repeat') {
                        speakAndSync(scriptText);
                      } else {
                        handleAskAgent(scriptText);
                      }
                    }
                  }
                }}
                placeholder={agentModeType === 'repeat' ? 'Type text to speak instantly...' : 'Ask anything...'}
                rows={3}
                className="w-full bg-transparent text-[#F5F5F7] text-xs leading-relaxed resize-none focus:outline-none placeholder:text-[#686873] custom-scrollbar"
              />

              {/* Internal Composer Toolbar */}
              <div className="flex items-center justify-between pt-2 border-t border-white/[0.04]">
                <span className="text-[10px] text-[#686873] font-mono flex items-center gap-1">
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
                      className="p-1.5 rounded-lg bg-white/[0.05] hover:bg-white/[0.1] text-[#F5F5F7] transition-colors"
                      title="Pause Speech"
                    >
                      <Pause size={13} strokeWidth={1.5} />
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={handlePlay}
                      disabled={!scriptText.trim()}
                      className="p-1.5 rounded-lg bg-white/[0.05] hover:bg-white/[0.1] disabled:opacity-30 text-[#9898A3] hover:text-[#F5F5F7] transition-colors"
                      title="Play Text Directly"
                    >
                      <Play size={13} strokeWidth={1.5} />
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={handleStop}
                    className="p-1.5 rounded-lg bg-white/[0.03] hover:bg-white/[0.08] text-[#686873] hover:text-[#F5F5F7] transition-colors"
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
                          speakAndSync(scriptText);
                        } else {
                          handleAskAgent(scriptText);
                        }
                      }
                    }}
                    disabled={!scriptText.trim() || playbackState === 'loading'}
                    className="h-7 px-3 rounded-lg bg-[#7C3AED] hover:bg-[#6D28D9] disabled:opacity-30 disabled:cursor-not-allowed text-white text-[11px] font-medium flex items-center justify-center gap-1.5 transition-all shadow-sm"
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
                    className="px-2.5 py-1 rounded-lg bg-[#1A1A1F] hover:bg-[#202027] border border-white/[0.06] hover:border-white/[0.12] text-[#9898A3] hover:text-[#F5F5F7] text-[10px] font-medium flex items-center gap-1.5 transition-all"
                  >
                    <IconComp size={11} strokeWidth={1.5} />
                    <span>{pill.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* ── 6. Assistant Technical Status Dashboard ── */}
          <div className="bg-[#1A1A1F] border border-white/[0.06] rounded-xl p-3 flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-medium text-[#686873] uppercase tracking-wider">
                AI Engine
              </span>
              <span className="text-[11px] font-medium text-[#F5F5F7] flex items-center gap-1.5">
                <Sparkles size={11} strokeWidth={1.5} className="text-[#8B5CF6]" />
                {agentHealthInfo.model}
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-1.5 pt-1.5 border-t border-white/[0.04]">
              <span className="px-2 py-0.5 rounded-md bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-[10px] font-medium flex items-center gap-1">
                <span className="w-1 h-1 rounded-full bg-emerald-400" />
                Local
              </span>
              <span className="px-2 py-0.5 rounded-md bg-white/[0.03] border border-white/[0.05] text-[#9898A3] text-[10px]">
                Memory Ready
              </span>
              <span className="px-2 py-0.5 rounded-md bg-white/[0.03] border border-white/[0.05] text-[#9898A3] text-[10px]">
                {agentHealthInfo.toolsCount} Tools
              </span>
              <span className="px-2 py-0.5 rounded-md bg-white/[0.03] border border-white/[0.05] text-[#9898A3] text-[10px]">
                Voice Ready
              </span>
            </div>
          </div>

          {/* ── 7. Conversations ── */}
          <div className="flex flex-col gap-2 pt-3 border-t border-white/[0.06]">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-medium text-[#686873] uppercase tracking-wider">
                Conversations
              </span>
              <span className="text-[10px] text-[#686873]">Local History</span>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setIsHistoryModalOpen(true)}
                className="flex-1 h-9 px-3 rounded-xl bg-[#1A1A1F] hover:bg-[#202027] border border-white/[0.06] hover:border-white/[0.12] text-xs font-medium text-[#F5F5F7] flex items-center justify-center gap-2 transition-all"
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
                className="h-9 px-3 rounded-xl bg-[#1A1A1F]/60 hover:bg-rose-500/10 border border-white/[0.05] hover:border-rose-500/20 text-[#686873] hover:text-rose-400 text-xs transition-all flex items-center justify-center gap-1.5"
                title="Clear conversation history"
              >
                <Trash2 size={13} strokeWidth={1.5} />
                {historyClearedToast ? <span className="text-[10px] font-medium text-rose-400">Cleared</span> : null}
              </button>
            </div>
          </div>

          {/* ── 8. Voice Packs (2-Column Grid) ── */}
          <div className="flex flex-col gap-2 pt-3 border-t border-white/[0.06]">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-medium text-[#686873] uppercase tracking-wider">
                Voice
              </span>
              <button
                type="button"
                onClick={handlePreviewVoice}
                className="text-[10px] px-2 py-0.5 rounded-lg bg-[#7C3AED]/10 hover:bg-[#7C3AED]/20 border border-[#7C3AED]/20 text-[#A78BFA] transition-all flex items-center gap-1"
              >
                <Play size={10} strokeWidth={1.5} />
                <span>Preview</span>
              </button>
            </div>

            <div className="grid grid-cols-2 gap-2 max-h-48 overflow-y-auto custom-scrollbar pr-1">
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
                    className={`p-2.5 rounded-xl text-left transition-all border flex flex-col gap-1 ${
                      isSelected
                        ? 'bg-[#1A1A1F] border-[#7C3AED] shadow-[0_0_15px_rgba(124,58,237,0.18)]'
                        : 'bg-[#1A1A1F]/60 border-white/[0.05] hover:border-white/[0.12] hover:bg-[#1A1A1F]'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className={`text-xs font-medium truncate ${isSelected ? 'text-[#F5F5F7]' : 'text-[#9898A3]'}`}>
                        {v.name.replace(/\(ElevenLabs\)|\(Neural\)/g, '').trim()}
                      </span>
                      <Volume2 size={12} strokeWidth={1.5} className={isSelected ? 'text-[#8B5CF6]' : 'text-[#686873]'} />
                    </div>
                    <div className="flex items-center justify-between text-[9px] text-[#686873]">
                      <span>{v.backend === 'elevenlabs' ? 'ElevenLabs (Cloud)' : v.backend === 'azure' ? 'Studio Neural HD' : 'Local'}</span>
                      {isSelected && <span className="w-1.5 h-1.5 rounded-full bg-[#8B5CF6]" />}
                    </div>
                  </button>
                );
              })}
            </div>

            {/* ── 8b. Lip-Sync Latency & Calibration ── */}
            <div className="p-3 rounded-xl bg-[#1A1A1F]/70 border border-white/[0.06] flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <Sliders size={12} strokeWidth={1.5} className="text-[#A78BFA]" />
                  <span className="text-[11px] font-medium text-[#F5F5F7]">
                    Lip-Sync Calibration
                  </span>
                </div>
                <span className="text-[10px] font-mono text-[#A78BFA] bg-[#7C3AED]/15 px-2 py-0.5 rounded-md border border-[#7C3AED]/25">
                  {lipSyncDelayMs > 0 ? `+${lipSyncDelayMs}ms delay` : `${lipSyncDelayMs}ms`}
                </span>
              </div>

              <p className="text-[10px] text-[#9898A3] leading-relaxed">
                Matches mouth movements with audio sound. Increase if lips move before voice; decrease if lips move after voice.
              </p>

              <div className="flex items-center gap-2 pt-0.5">
                <span className="text-[9px] text-[#686873] font-mono whitespace-nowrap">-50ms</span>
                <input
                  type="range"
                  min="-50"
                  max="350"
                  step="10"
                  value={lipSyncDelayMs}
                  onChange={(e) => setLipSyncDelayMs(Number(e.target.value))}
                  className="flex-1 h-1.5 bg-[#111113] rounded-lg appearance-none cursor-pointer accent-[#7C3AED]"
                />
                <span className="text-[9px] text-[#686873] font-mono whitespace-nowrap">+350ms</span>
              </div>

              {/* Quick Presets */}
              <div className="grid grid-cols-3 gap-1.5 pt-0.5">
                <button
                  type="button"
                  onClick={() => setLipSyncDelayMs(120)}
                  className={`py-1 px-1.5 rounded-lg text-[9px] font-medium border text-center transition-all ${
                    lipSyncDelayMs === 120
                      ? 'bg-[#7C3AED]/20 border-[#7C3AED] text-[#F5F5F7]'
                      : 'bg-[#111113]/50 border-white/[0.04] text-[#9898A3] hover:text-[#F5F5F7]'
                  }`}
                  title="Optimal sync for built-in laptop and monitor speakers"
                >
                  Standard (120ms)
                </button>
                <button
                  type="button"
                  onClick={() => setLipSyncDelayMs(200)}
                  className={`py-1 px-1.5 rounded-lg text-[9px] font-medium border text-center transition-all ${
                    lipSyncDelayMs === 200
                      ? 'bg-[#7C3AED]/20 border-[#7C3AED] text-[#F5F5F7]'
                      : 'bg-[#111113]/50 border-white/[0.04] text-[#9898A3] hover:text-[#F5F5F7]'
                  }`}
                  title="Compensates for extra Bluetooth headphone latency"
                >
                  Bluetooth (200ms)
                </button>
                <button
                  type="button"
                  onClick={() => setLipSyncDelayMs(0)}
                  className={`py-1 px-1.5 rounded-lg text-[9px] font-medium border text-center transition-all ${
                    lipSyncDelayMs === 0
                      ? 'bg-[#7C3AED]/20 border-[#7C3AED] text-[#F5F5F7]'
                      : 'bg-[#111113]/50 border-white/[0.04] text-[#9898A3] hover:text-[#F5F5F7]'
                  }`}
                  title="Direct 0ms offset"
                >
                  Direct (0ms)
                </button>
              </div>
            </div>

            {/* Cloud & AI API Keys Accordion */}
            <div className="pt-0.5">
              <button
                type="button"
                onClick={() => setShowKeyConfig(!showKeyConfig)}
                className="text-[10px] text-[#686873] hover:text-[#9898A3] flex items-center gap-1.5 transition-colors"
              >
                <Key size={11} strokeWidth={1.5} />
                <span>{showKeyConfig ? 'Hide Cloud API Keys' : 'Configure Cloud API Keys (Grok, Gemini, Voices)'}</span>
              </button>

              {showKeyConfig && (
                <div className="mt-2 p-3 rounded-xl bg-[#1A1A1F] border border-white/[0.06] space-y-3">
                  {/* Tab Selector */}
                  <div className="flex items-center gap-1 p-1 bg-[#111113] rounded-lg border border-white/[0.05]">
                    <button
                      type="button"
                      onClick={() => setActiveKeyTab('grok')}
                      className={`flex-1 py-1 text-[10px] font-medium rounded-md transition-all flex items-center justify-center gap-1 ${
                        activeKeyTab === 'grok'
                          ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/30'
                          : 'text-[#9898A3] hover:text-[#F5F5F7]'
                      }`}
                    >
                      <Sparkles size={10} />
                      <span>Grok</span>
                      {keyStatuses.grok && <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />}
                    </button>
                    <button
                      type="button"
                      onClick={() => setActiveKeyTab('gemini')}
                      className={`flex-1 py-1 text-[10px] font-medium rounded-md transition-all flex items-center justify-center gap-1 ${
                        activeKeyTab === 'gemini'
                          ? 'bg-[#7C3AED]/20 text-[#A78BFA] border border-[#7C3AED]/30'
                          : 'text-[#9898A3] hover:text-[#F5F5F7]'
                      }`}
                    >
                      <Sparkles size={10} />
                      <span>Gemini</span>
                      {keyStatuses.gemini && <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />}
                    </button>
                    <button
                      type="button"
                      onClick={() => setActiveKeyTab('elevenlabs')}
                      className={`flex-1 py-1 text-[10px] font-medium rounded-md transition-all flex items-center justify-center gap-1 ${
                        activeKeyTab === 'elevenlabs'
                          ? 'bg-blue-500/20 text-blue-300 border border-blue-500/30'
                          : 'text-[#9898A3] hover:text-[#F5F5F7]'
                      }`}
                    >
                      <Volume2 size={10} />
                      <span>Voices</span>
                      {keyStatuses.elevenlabs && <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />}
                    </button>
                  </div>

                  {/* Grok Key Panel */}
                  {activeKeyTab === 'grok' && (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] text-[#9898A3]">xAI Grok API Key</span>
                        <a
                          href="https://console.x.ai/"
                          target="_blank"
                          rel="noreferrer"
                          className="text-[10px] text-cyan-400 hover:underline flex items-center gap-1"
                        >
                          <span>Get xAI Key</span>
                          <ExternalLink size={9} />
                        </a>
                      </div>
                      <input
                        type="password"
                        value={grokKey}
                        onChange={(e) => setGrokKey(e.target.value)}
                        placeholder="xai-..."
                        className="w-full bg-[#111113] border border-white/10 rounded-lg px-2.5 py-1.5 text-xs text-[#F5F5F7] placeholder:text-[#686873] focus:outline-none focus:border-cyan-500"
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
                        className="w-full py-1.5 rounded-lg bg-cyan-500 hover:bg-cyan-600 text-black text-xs font-semibold transition-all"
                      >
                        {keyToastMessage || 'Save Grok Key'}
                      </button>
                    </div>
                  )}

                  {/* Gemini Key Panel */}
                  {activeKeyTab === 'gemini' && (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] text-[#9898A3]">Google Gemini API Key (Free)</span>
                        <a
                          href="https://aistudio.google.com/app/apikey"
                          target="_blank"
                          rel="noreferrer"
                          className="text-[10px] text-[#A78BFA] hover:underline flex items-center gap-1"
                        >
                          <span>Get Free Key</span>
                          <ExternalLink size={9} />
                        </a>
                      </div>
                      <input
                        type="password"
                        value={geminiKey}
                        onChange={(e) => setGeminiKey(e.target.value)}
                        placeholder="AIzaSy..."
                        className="w-full bg-[#111113] border border-white/10 rounded-lg px-2.5 py-1.5 text-xs text-[#F5F5F7] placeholder:text-[#686873] focus:outline-none focus:border-[#7C3AED]"
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
                        className="w-full py-1.5 rounded-lg bg-[#7C3AED] hover:bg-[#6D28D9] text-white text-xs font-semibold transition-all"
                      >
                        {keyToastMessage || 'Save Gemini Key'}
                      </button>
                    </div>
                  )}

                  {/* ElevenLabs Key Panel */}
                  {activeKeyTab === 'elevenlabs' && (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] text-[#9898A3]">ElevenLabs Voice Key</span>
                        <a
                          href="https://elevenlabs.io"
                          target="_blank"
                          rel="noreferrer"
                          className="text-[10px] text-blue-400 hover:underline flex items-center gap-1"
                        >
                          <span>elevenlabs.io</span>
                          <ExternalLink size={9} />
                        </a>
                      </div>
                      <input
                        type="password"
                        value={elevenLabsKey}
                        onChange={(e) => setElevenLabsKey(e.target.value)}
                        placeholder="Paste xi-api-key..."
                        className="w-full bg-[#111113] border border-white/10 rounded-lg px-2.5 py-1.5 text-xs text-[#F5F5F7] placeholder:text-[#686873] focus:outline-none focus:border-blue-500"
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
                        className="w-full py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold transition-all"
                      >
                        {keyToastMessage || 'Save ElevenLabs Key'}
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* ── 9. Studio & Camera ── */}
          <div className="flex flex-col gap-2 pt-3 border-t border-white/[0.06]">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-medium text-[#686873] uppercase tracking-wider">
                Studio & Camera
              </span>
              <label className="text-[10px] text-[#8B5CF6] hover:text-white cursor-pointer transition-colors flex items-center gap-1">
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
            <div className="grid grid-cols-2 gap-1.5 p-1 bg-[#1A1A1F] border border-white/[0.05] rounded-xl">
              <button
                type="button"
                onClick={() => setActiveCamera('wide')}
                className={`py-1.5 px-2 rounded-lg text-xs font-medium transition-all flex items-center justify-center gap-1.5 ${
                  activeCamera === 'wide'
                    ? 'bg-[#7C3AED] text-white'
                    : 'text-[#9898A3] hover:text-[#F5F5F7]'
                }`}
              >
                <Maximize2 size={12} strokeWidth={1.5} />
                <span>Studio Wide</span>
              </button>
              <button
                type="button"
                onClick={() => setActiveCamera('closeup')}
                className={`py-1.5 px-2 rounded-lg text-xs font-medium transition-all flex items-center justify-center gap-1.5 ${
                  activeCamera === 'closeup'
                    ? 'bg-[#7C3AED] text-white'
                    : 'text-[#9898A3] hover:text-[#F5F5F7]'
                }`}
              >
                <Focus size={12} strokeWidth={1.5} />
                <span>Close-up</span>
              </button>
            </div>

            {/* Background Theme Switcher */}
            <div className="grid grid-cols-2 gap-1.5 p-1 bg-[#1A1A1F] border border-white/[0.05] rounded-xl">
              <button
                type="button"
                onClick={() => setSceneTheme('creator_loft')}
                className={`py-1.5 px-2 rounded-lg text-xs font-medium transition-all flex items-center justify-center gap-1.5 ${
                  sceneTheme === 'creator_loft'
                    ? 'bg-white/10 text-white'
                    : 'text-[#9898A3] hover:text-[#F5F5F7]'
                }`}
              >
                <Coffee size={12} strokeWidth={1.5} />
                <span>Creator Loft</span>
              </button>
              <button
                type="button"
                onClick={() => setSceneTheme('broadcast_studio')}
                className={`py-1.5 px-2 rounded-lg text-xs font-medium transition-all flex items-center justify-center gap-1.5 ${
                  sceneTheme === 'broadcast_studio'
                    ? 'bg-white/10 text-white'
                    : 'text-[#9898A3] hover:text-[#F5F5F7]'
                }`}
              >
                <Tv size={12} strokeWidth={1.5} />
                <span>News Studio</span>
              </button>
            </div>
          </div>

        </div>
      </aside>
    </>
  );
}
