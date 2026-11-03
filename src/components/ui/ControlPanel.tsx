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
  getAgentKeyStatus,
  getAgentHistory
} from '@/services/agentService';
import { auraController } from '@/services/auraConversationController';
import SessionChatPanel from './SessionChatPanel';
import SessionSidebar from './SessionSidebar';
import {
  TYPO,
  BUTTONS,
  SURFACES,
  FORMS,
  STATUS_DOTS,
} from './designSystem';
import {
  Send,
  Play,
  Check,
  Trash2,
  Key,
  Maximize2,
  Focus,
  X,
  Sparkles,
  Sliders,
  MessageSquare,
  Mic,
  Waves,
  Eye,
  EyeOff,
  Search,
  CheckCircle2,
  Database,
  RefreshCw,
  ExternalLink,
  Copy,
  ShieldCheck,
  Lock
} from 'lucide-react';
import {
  fetchSupabaseStatus,
  saveSupabaseConfig,
  triggerSupabaseSync,
  type SupabaseStatusResponse
} from '@/services/supabaseClient';
import { getSpeechCompletionDelay } from '@/utils/speechCompletionDelay';
import { isComplexReasoning } from '@/utils/reasoningDetector';

export default function ControlPanel() {
  const [chatViewMode, setChatViewMode] = useState<'chat' | 'sessions'>('chat');
  const {
    scriptText, setScriptText,
    playbackState, setPlaybackState,
    selectedVoice, setSelectedVoice,
    setTtsBackend,
    voices, setVoices,
    activeCamera, setActiveCamera,
    setIsSpeaking,
    setSpeechText,
    lipSyncDelayMs, setLipSyncDelayMs,
    isListening, setIsListening,
    autoRepeat, setAutoRepeat,
    agentModeType, setAgentModeType,
    agentSpeed, setAgentSpeed,
    agentStatus, setAgentStatus,
    setCurrentAgentAction,
    setPendingConfirmation,
    setAgentModelName,
    setActiveTaskSteps,
    setLastFullResponse,
    setError,
    activeNavTab: storeNavTab,
    setActiveNavTab: setStoreNavTab,
    isControlPanelCollapsed,
    setIsControlPanelCollapsed,
    isAlwaysOnMic,
    setIsAlwaysOnMic
  } = useAppStore();

  // Drawer open state synced with store
  const isCollapsed = isControlPanelCollapsed;
  const setIsCollapsed = setIsControlPanelCollapsed;

  // Active drawer tab: 'chat' | 'voice' | 'settings'
  const [activeTab, setActiveTab] = useState<'chat' | 'voice' | 'settings'>('chat');

  // Voice library search
  const [voiceSearchQuery, setVoiceSearchQuery] = useState('');

  // History state
  const [chatHistory, setChatHistory] = useState<Array<{ role: string; content: string }>>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyClearing, setHistoryClearing] = useState(false);

  // API keys state
  const [elevenLabsKey, setElevenLabsKey] = useState<string>(() => {
    return typeof window !== 'undefined' ? localStorage.getItem('elevenlabs_api_key') || '' : '';
  });
  const [grokKey, setGrokKey] = useState<string>(() => {
    return typeof window !== 'undefined' ? localStorage.getItem('grok_api_key') || localStorage.getItem('xai_api_key') || '' : '';
  });
  const [geminiKey, setGeminiKey] = useState<string>(() => {
    return typeof window !== 'undefined' ? localStorage.getItem('gemini_api_key') || '' : '';
  });
  const [showKeySecret, setShowKeySecret] = useState(false);
  const [activeKeyProvider, setActiveKeyProvider] = useState<'gemini' | 'grok' | 'elevenlabs'>('gemini');
  const [keyStatuses, setKeyStatuses] = useState<{ grok: boolean; gemini: boolean; elevenlabs: boolean }>({
    grok: false,
    gemini: false,
    elevenlabs: false
  });
  const [keyToastMessage, setKeyToastMessage] = useState<string | null>(null);

  // Supabase Cloud Database state
  const [supabaseUrl, setSupabaseUrl] = useState<string>(() => {
    return typeof window !== 'undefined' ? localStorage.getItem('supabase_url') || '' : '';
  });
  const [supabaseKey, setSupabaseKey] = useState<string>(() => {
    return typeof window !== 'undefined' ? localStorage.getItem('supabase_anon_key') || '' : '';
  });
  const [showSupabaseKey, setShowSupabaseKey] = useState(false);
  const [supabaseStatus, setSupabaseStatus] = useState<SupabaseStatusResponse | null>(null);
  const [supabaseLoading, setSupabaseLoading] = useState(false);
  const [supabaseSyncing, setSupabaseSyncing] = useState(false);
  const [supabaseToast, setSupabaseToast] = useState<string | null>(null);
  const [showSqlHelper, setShowSqlHelper] = useState(false);
  const [copiedSql, setCopiedSql] = useState(false);
  const [showAdvancedConfig, setShowAdvancedConfig] = useState(false);

  // Diagnostics health
  const [agentHealthInfo, setAgentHealthInfo] = useState<{
    connected: boolean;
    model: string;
    toolsCount: number;
    memoryReady: boolean;
  }>({
    connected: true,
    model: 'gemini-3.5-flash',
    toolsCount: 28,
    memoryReady: true
  });

  const recognitionRef = useRef<SpeechRecognizerController | null>(null);
  const silenceTimerRef = useRef<any>(null);
  const userWantsListeningRef = useRef(false);
  const lastAccumulatedTranscriptRef = useRef<string>('');

  // Sync drawer tab with left sidebar storeNavTab
  useEffect(() => {
    if (storeNavTab === 'home') {
      setIsControlPanelCollapsed(true);
    } else if (storeNavTab === 'chat') {
      setIsControlPanelCollapsed(false);
      setActiveTab('chat');
      loadHistory();
    } else if (storeNavTab === 'voice') {
      setIsControlPanelCollapsed(false);
      setActiveTab('voice');
    } else if (storeNavTab === 'settings') {
      setIsControlPanelCollapsed(false);
      setActiveTab('settings');
    }
  }, [storeNavTab, setIsControlPanelCollapsed]);

  const loadHistory = useCallback(() => {
    setHistoryLoading(true);
    getAgentHistory()
      .then((items) => setChatHistory(items || []))
      .finally(() => setHistoryLoading(false));
  }, []);

  // Initialize voices and check system health
  useEffect(() => {
    const init = async () => {
      try {
        const curVoices = await loadAllCuratedVoices();
        setVoices(curVoices);
        const savedVoiceId = typeof window !== 'undefined' ? localStorage.getItem('talking_character_selected_voice') : null;
        const lilyId = 'pFZP5JQG7iQjIQuC4Bku';
        const targetId = (savedVoiceId && savedVoiceId !== 'hpp4J3VqNfWAUOO0d1Us' && savedVoiceId !== 'en-US-JennyNeural' && curVoices.some(v => v.id === savedVoiceId))
          ? savedVoiceId
          : lilyId;
        const match = curVoices.find(v => v.id === targetId) || curVoices[0];
        if (match) {
          setSelectedVoice(match.id);
          setTtsBackend('elevenlabs');
          if (typeof window !== 'undefined') {
            try {
              localStorage.setItem('talking_character_selected_voice', match.id);
              localStorage.setItem('talking_character_tts_backend', 'elevenlabs');
            } catch {}
          }
        }
      } catch (err) {
        console.warn('Voice loader notice:', err);
      }

      try {
        const health = await getAgentHealth();
        if (health) {
          setAgentHealthInfo({
            connected: !!health.status || !!health.connected,
            model: health.model || 'Google Gemini 3.5 Flash',
            toolsCount: health.toolsCount || 28,
            memoryReady: true
          });
          // health.model used for diagnostics only — don't override user's engine selection
        }
      } catch {}

      try {
        const keyStatus = await getAgentKeyStatus();
        if (keyStatus) {
          setKeyStatuses(keyStatus);
        }
      } catch {}

      try {
        const spStatus = await fetchSupabaseStatus();
        if (spStatus) {
          setSupabaseStatus(spStatus);
          if (spStatus.url && !supabaseUrl) {
            setSupabaseUrl(spStatus.url);
          }
        }
      } catch {}
    };

    init();
  }, [setVoices, setSelectedVoice, setTtsBackend, setAgentModelName, supabaseUrl]);

  // Clean Markdown syntax before sending to speech synthesis
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

  const speakAndSync = useCallback(async (textToSpeak: string, isInstantRepeat: boolean = false) => {
    const cleaned = cleanTextForSpeech(textToSpeak);
    if (!cleaned) return;

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
  const handleAskAgent = useCallback(async (rawPromptText?: string) => {
    const promptToSend = rawPromptText !== undefined ? rawPromptText : scriptText;
    const trimmed = promptToSend.trim();
    if (!trimmed) return;

    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }

    voiceManager.stopAll('new_task');
    setScriptText('');
    setAgentStatus('thinking');
    setCurrentAgentAction(null);
    setPlaybackState('loading');
    setError(null);
    setActiveTaskSteps([{ title: 'Thinking & analyzing query...', status: 'in_progress' }]);

    try {
      const isReasoning = isComplexReasoning(trimmed);
      const providerMapping = isReasoning
        ? 'langgraph'
        : (agentSpeed === 'instant' ? 'local_fallback' : (agentSpeed || 'gemini'));

      if (isReasoning) {
        setAgentModelName('Deep Think');
        setAgentSpeed('langgraph');
      }

      const res = await sendAgentMessage(trimmed, {
        mode: agentModeType,
        modelProvider: providerMapping,
        maxTokens: 2048
      });

      // Synchronize intelligence mode pill with actual model used
      const isLangGraph = res.modelUsed?.toLowerCase().includes('langgraph') || res.modelUsed?.toLowerCase().includes('reasoning') || isReasoning;
      if (isLangGraph) {
        setAgentModelName('Deep Think');
        setAgentSpeed('langgraph');
      } else if (agentSpeed !== 'langgraph' && agentSpeed !== 'instant') {
        setAgentModelName('Balanced');
        setAgentSpeed('gemini');
      }

      // Display clean response on screen matching spoken voice
      const cleaned = cleanTextForSpeech(res.response);
      setSpeechText(cleaned);
      setLastFullResponse(res.response);

      if (res.pendingConfirmation) {
        setPendingConfirmation(res.pendingConfirmation);
        setAgentStatus('awaiting_confirmation');
        await speakAndSync(cleaned);
      } else {
        setAgentStatus('speaking');
        if (res.toolsExecuted && res.toolsExecuted.length > 0) {
          const toolNames = res.toolsExecuted.map((t) => t.name).join(', ');
          setCurrentAgentAction(`Executed: ${toolNames}`);
          setActiveTaskSteps([
            { title: 'Analyze prompt', status: 'completed' },
            { title: `Executed: ${toolNames}`, status: 'completed' },
            { title: 'Synthesize spoken response', status: 'completed' }
          ]);
        } else {
          setActiveTaskSteps([
            { title: 'Analyze prompt', status: 'completed' },
            { title: isLangGraph ? 'Deep Reasoning & Analytical Synthesis' : 'Evaluate local capabilities & tools', status: 'completed' },
            { title: 'Synthesize spoken response', status: 'completed' }
          ]);
          setTimeout(() => {
            setActiveTaskSteps([]);
          }, 1200);
        }

        await speakAndSync(cleaned);
      }

      // Refresh history turns
      loadHistory();
    } catch (err: any) {
      console.error('Agent query error:', err);
      setAgentStatus('error');
      setError(err?.message || 'Agent query error');
      setActiveTaskSteps([]);
      setPlaybackState('idle');
    }
  }, [scriptText, agentSpeed, agentModeType, setScriptText, setAgentStatus, setCurrentAgentAction, setPlaybackState, setError, setActiveTaskSteps, setAgentModelName, setAgentSpeed, setSpeechText, setPendingConfirmation, speakAndSync, setLastFullResponse, loadHistory]);

  const toggleMic = useCallback(() => {
    if (isListening) {
      const textToSend = (lastAccumulatedTranscriptRef.current || '').trim();
      stopListening();
      if (textToSend) {
        lastAccumulatedTranscriptRef.current = '';
        setScriptText('');
        handleAskAgent(textToSend);
      } else {
        setAgentStatus('idle');
      }
    } else {
      voiceManager.stopAll('toggle_mic');
      if (!isSpeechRecognitionSupported()) {
        setError('Microphone speech recognition requires Google Chrome, Edge, or Brave browser.');
        return;
      }

      setAgentStatus('listening');
      userWantsListeningRef.current = true;
      lastAccumulatedTranscriptRef.current = '';

      let accumulated = '';
      const recognition = createSpeechRecognizer({
        onTranscript: (transcript: string, isFinal: boolean) => {
          accumulated = transcript;
          lastAccumulatedTranscriptRef.current = transcript;
          setScriptText(transcript);

          if (silenceTimerRef.current) {
            clearTimeout(silenceTimerRef.current);
          }

          const isRepeat = useAppStore.getState().agentModeType === 'repeat';
          const delay = getSpeechCompletionDelay(accumulated, isFinal, isRepeat ? 'repeat' : 'agent');

          silenceTimerRef.current = setTimeout(async () => {
            userWantsListeningRef.current = false;
            stopListening();
            const toProcess = (accumulated || lastAccumulatedTranscriptRef.current).trim();
            accumulated = '';
            lastAccumulatedTranscriptRef.current = '';
            if (toProcess) {
              setScriptText('');
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
          console.error('Recognition start error:', e);
        }
      }
    }
  }, [isListening, stopListening, setAgentStatus, setError, setIsListening, setScriptText, speakAndSync, handleAskAgent]);

  // Voice Selection & Instant Preview
  const handleSelectVoice = (vId: string) => {
    stopListening();
    const cur = voices.find(v => v.id === vId);
    if (!cur) return;
    setSelectedVoice(cur.id);
    setTtsBackend(cur.backend);
    if (typeof window !== 'undefined') {
      try {
        localStorage.setItem('talking_character_selected_voice', cur.id);
      } catch {}
    }
    voiceManager.playPreview(cur);
  };

  // Clear Conversation History
  const handleClearHistory = async () => {
    setHistoryClearing(true);
    await clearAgentHistory();
    setChatHistory([]);
    setHistoryClearing(false);
  };

  // Save API Key
  const handleSaveKey = async (provider: 'gemini' | 'grok' | 'elevenlabs', val: string) => {
    const trimmed = val.trim();
    if (provider === 'gemini') {
      setGeminiKey(trimmed);
      try { localStorage.setItem('gemini_api_key', trimmed); } catch {}
    } else if (provider === 'grok') {
      setGrokKey(trimmed);
      try { 
        localStorage.setItem('grok_api_key', trimmed); 
        localStorage.setItem('xai_api_key', trimmed); 
      } catch {}
    } else if (provider === 'elevenlabs') {
      setElevenLabsKey(trimmed);
      try { localStorage.setItem('elevenlabs_api_key', trimmed); } catch {}
      saveElevenLabsKey(trimmed);
    }

    try {
      await saveAgentApiKey(provider, trimmed);
      setKeyStatuses(prev => ({ ...prev, [provider]: !!trimmed }));
      setKeyToastMessage(`✓ ${provider.toUpperCase()} API key saved securely!`);
      setTimeout(() => setKeyToastMessage(null), 3000);
    } catch {
      setKeyToastMessage(`✓ Key saved in client session`);
      setTimeout(() => setKeyToastMessage(null), 3000);
    }
  };

  const SCHEMA_SQL = `-- Supabase Schema for Talking Character & Personal AI Assistant
CREATE TABLE IF NOT EXISTS public.memories (
  id TEXT PRIMARY KEY,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  category TEXT DEFAULT 'fact',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS public.tasks (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  status TEXT DEFAULT 'pending',
  priority TEXT DEFAULT 'medium',
  due_date TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);
CREATE TABLE IF NOT EXISTS public.notes (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  tags TEXT[] DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS public.reminders (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  remind_at TEXT NOT NULL,
  triggered BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS public.conversations (
  id BIGSERIAL PRIMARY KEY,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  model_used TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS public.user_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE public.memories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reminders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all anon" ON public.memories FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all anon" ON public.tasks FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all anon" ON public.notes FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all anon" ON public.reminders FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all anon" ON public.conversations FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all anon" ON public.user_settings FOR ALL USING (true) WITH CHECK (true);`;

  const handleConnectSupabase = async () => {
    if (!supabaseUrl.trim() || !supabaseKey.trim()) {
      setSupabaseToast('Please provide both Project URL and Anon/Service Key');
      setTimeout(() => setSupabaseToast(null), 3500);
      return;
    }
    setSupabaseLoading(true);
    setSupabaseToast(null);
    try {
      const res = await saveSupabaseConfig(supabaseUrl.trim(), supabaseKey.trim());
      const updatedStatus = await fetchSupabaseStatus();
      setSupabaseStatus(updatedStatus);
      if (res.connection?.connected) {
        setSupabaseToast('✓ Connected to Supabase successfully!');
      } else {
        setSupabaseToast(`⚠️ Connected, but check schema: ${res.connection?.message || 'Tables missing'}`);
      }
    } catch (err: any) {
      setSupabaseToast(`✗ Error: ${err.message || 'Failed to connect'}`);
    } finally {
      setSupabaseLoading(false);
      setTimeout(() => setSupabaseToast(null), 4500);
    }
  };

  const handleSyncSupabase = async () => {
    setSupabaseSyncing(true);
    setSupabaseToast(null);
    try {
      const res = await triggerSupabaseSync('both');
      const updatedStatus = await fetchSupabaseStatus();
      setSupabaseStatus(updatedStatus);
      setSupabaseToast(`✓ Cloud sync complete! (Memories: ${res.pulled?.memories ?? 0} pulled, Tasks: ${res.pulled?.tasks ?? 0} pulled)`);
    } catch (err: any) {
      setSupabaseToast(`✗ Sync failed: ${err.message || 'Error syncing'}`);
    } finally {
      setSupabaseSyncing(false);
      setTimeout(() => setSupabaseToast(null), 4500);
    }
  };

  const handleCopySql = () => {
    if (navigator?.clipboard) {
      navigator.clipboard.writeText(SCHEMA_SQL);
      setCopiedSql(true);
      setTimeout(() => setCopiedSql(false), 2500);
    }
  };

  // Filter voices: exclusively ElevenLabs voice pack
  const filteredVoices = voices.filter((v) => {
    const isEleven = v.backend === 'elevenlabs';
    const matchesSearch =
      !voiceSearchQuery ||
      v.name.toLowerCase().includes(voiceSearchQuery.toLowerCase()) ||
      v.lang.toLowerCase().includes(voiceSearchQuery.toLowerCase()) ||
      (v.description && v.description.toLowerCase().includes(voiceSearchQuery.toLowerCase()));

    return isEleven && matchesSearch;
  });

  const quickPrompts = [
    "Introduce yourself in 2 sentences",
    "Tell me what tools you have access to",
    "What is the capital of Japan?",
    "Check system memory and diagnostics",
  ];

  return (
    <>
      <aside
        aria-label="Studio AI Inspector & Settings Drawer"
        className={`fixed right-4 top-4 bottom-4 w-[480px] lg:w-[540px] xl:w-[580px] max-md:w-[94vw] max-md:right-[3vw] z-50 transition-all duration-300 ease-out transform-gpu pointer-events-auto ${
          isCollapsed 
            ? 'translate-x-[calc(100%+2rem)] opacity-0 pointer-events-none' 
            : 'translate-x-0 opacity-100'
        }`}
      >
        {/* ── Solid Charcoal Shell (#181818) ── */}
        <div className="h-full bg-[#14161E]/95 backdrop-blur-3xl border border-[#23252F] rounded-[24px] shadow-[0_24px_80px_rgba(0,0,0,0.95),0_0_50px_rgba(200,168,130,0.06)] flex flex-col overflow-hidden">

          {/* ── 1. Drawer Header ── */}
          <div className="px-5 py-4 border-b border-[#23252F] bg-[#14161E]/70 flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-full bg-[#1A1D27] border border-[#8B7CFF]/30 flex items-center justify-center text-[#8B7CFF]">
                <Sparkles size={17} strokeWidth={1.75} />
              </div>
              <div>
                <h2 className="text-[13px] font-semibold tracking-[0.22em] uppercase text-[#F2F2F2] font-sans">
                  AI STUDIO
                </h2>
                <p className="text-[11px] text-[#7A7D86] font-sans">
                  Assistant Telemetry & Studio Controls
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#1A1D27] border border-[#23252F] text-[11px] font-sans text-[#C9CBD3]">
                <span className={agentHealthInfo.connected ? STATUS_DOTS.success : STATUS_DOTS.danger} />
                <span className="tracking-wide">{agentHealthInfo.connected ? 'ONLINE' : 'OFFLINE'}</span>
              </div>

              <button
                type="button"
                onClick={() => {
                  setIsCollapsed(true);
                  setStoreNavTab('home');
                }}
                className="w-8 h-8 rounded-full bg-[#1A1D27] border border-[#23252F] flex items-center justify-center text-[#7A7D86] hover:text-[#F2F2F2] hover:bg-[#202431] active:scale-95 transition shadow-sm cursor-pointer"
                title="Close Drawer"
              >
                <X size={15} strokeWidth={1.75} />
              </button>
            </div>
          </div>

          {/* ── 2. Top-Level Tab Switcher ── */}
          <div className="p-3 border-b border-[#23252F] bg-[#14161E]">
            <div className="grid grid-cols-3 gap-1.5 p-1 bg-[#1A1D27] border border-[#23252F] rounded-full">
              <button
                type="button"
                onClick={() => {
                  setActiveTab('chat');
                  setStoreNavTab('chat');
                  loadHistory();
                }}
                className={`py-2 px-3 rounded-full text-xs font-medium transition-all duration-150 flex items-center justify-center gap-2 active:scale-95 cursor-pointer ${
                  activeTab === 'chat' ? 'bg-[#8B7CFF] text-[#FFFFFF] font-semibold shadow-[0_2px_10px_rgba(139,124,255,0.35)]'
                    : 'text-[#7A7D86] hover:text-[#F2F2F2] hover:bg-white/[0.04]'
                }`}
              >
                <MessageSquare size={14} strokeWidth={2} />
                <span>Chat</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setActiveTab('voice');
                  setStoreNavTab('voice');
                }}
                className={`py-2 px-3 rounded-full text-xs font-medium transition-all duration-150 flex items-center justify-center gap-2 active:scale-95 cursor-pointer ${
                  activeTab === 'voice' ? 'bg-[#8B7CFF] text-[#FFFFFF] font-semibold shadow-[0_2px_10px_rgba(139,124,255,0.35)]'
                    : 'text-[#7A7D86] hover:text-[#F2F2F2] hover:bg-white/[0.04]'
                }`}
              >
                <Mic size={14} strokeWidth={2} />
                <span>Voice</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setActiveTab('settings');
                  setStoreNavTab('settings');
                }}
                className={`py-2 px-3 rounded-full text-xs font-medium transition-all duration-150 flex items-center justify-center gap-2 active:scale-95 cursor-pointer ${
                  activeTab === 'settings' ? 'bg-[#8B7CFF] text-[#FFFFFF] font-semibold shadow-[0_2px_10px_rgba(139,124,255,0.35)]'
                    : 'text-[#7A7D86] hover:text-[#F2F2F2] hover:bg-white/[0.04]'
                }`}
              >
                <Sliders size={14} strokeWidth={2} />
                <span>Settings</span>
              </button>
            </div>
          </div>

        {/* ── 3. Scrollable Tab Content ── */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5 custom-scrollbar">

          {/* ══════════════════════════════════════════════════════════════ */}
          {/* TAB 1: CHAT & PERSISTENT SESSION MEMORY                     */}
          {/* ══════════════════════════════════════════════════════════════ */}
          {activeTab === 'chat' && (
            <div className="h-full flex flex-col min-h-0 -m-5">
              <div className="flex-1 min-h-0 overflow-hidden">
                {chatViewMode === 'chat' ? (
                  <SessionChatPanel
                    onBackToSessions={() => setChatViewMode('sessions')}
                    showBackControl={false}
                  />
                ) : (
                  <SessionSidebar
                    onSessionSelect={() => setChatViewMode('chat')}
                  />
                )}
              </div>
            </div>
          )}

          {/* ══════════════════════════════════════════════════════════════ */}
          {/* TAB 2: VOICE STUDIO & SPEECH                                 */}
          {/* ══════════════════════════════════════════════════════════════ */}
          {activeTab === 'voice' && (
            <div className="space-y-5">
              {/* ElevenLabs Voice Pack Banner */}
              <div className="flex items-center justify-between p-3.5 rounded-[16px] bg-[#1A1D27] border border-[#23252F]">
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="w-8 h-8 rounded-full bg-[#8B7CFF]/15 border border-[#8B7CFF]/30 flex items-center justify-center text-[#8B7CFF] shrink-0">
                    <Sparkles size={16} strokeWidth={1.75} />
                  </div>
                  <div className="min-w-0">
                    <h3 className="text-xs font-semibold text-[#F2F2F2] font-sans truncate">
                      ElevenLabs Voice Pack
                    </h3>
                    <p className="text-[10px] text-[#7A7D86] font-mono">
                      {filteredVoices.length} Premium Neural Voice{filteredVoices.length === 1 ? '' : 's'}
                    </p>
                  </div>
                </div>
                <span className="text-[10px] px-2.5 py-1 rounded-full bg-[#A78BFA]/15 text-[#C4B5FD] font-mono uppercase font-semibold border border-[#A78BFA]/25 tracking-wide shrink-0">
                  Active Pack
                </span>
              </div>

              {/* Voice Search */}
              <div className="relative">
                <Search size={16} strokeWidth={1.5} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[#7A7D86]" />
                <input
                  type="text"
                  value={voiceSearchQuery}
                  onChange={(e) => setVoiceSearchQuery(e.target.value)}
                  placeholder="Search voices by name or language..."
                  className="w-full w-full bg-[#1A1D27] border border-[#23252F] focus:border-[#8B7CFF]/60 focus:ring-1 focus:ring-[#8B7CFF]/25 rounded-full pl-10 pr-4 py-2 text-xs md:text-sm text-[#F2F2F2] placeholder-[#7A7D86] focus:outline-none transition font-sans"
                />
              </div>

              {/* Voice Catalog List with Gaps */}
              <div className="flex flex-col gap-2.5 max-h-[340px] overflow-y-auto custom-scrollbar pr-1">
                {filteredVoices.map((voice) => {
                  const isSelected = selectedVoice === voice.id;

                  return (
                    <div
                      key={voice.id}
                      onClick={() => handleSelectVoice(voice.id)}
                      className={`p-3 rounded-2xl border transition-all duration-150 flex items-center justify-between cursor-pointer active:scale-[0.99] ${
                        isSelected ? 'bg-[#202431] border-[#8B7CFF]/50 ring-1 ring-[#8B7CFF]/30' : 'bg-[#1A1D27] border border-[#23252F] hover:border-[#8B7CFF]/30 hover:bg-[#202431]'
                      }`}
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleSelectVoice(voice.id);
                          }}
                          className="w-8 h-8 rounded-full bg-[#1A1D27] hover:bg-[#8B7CFF] text-[#7A7D86] hover:text-[#FFFFFF] flex items-center justify-center transition active:scale-90 shrink-0 border border-[#23252F] hover:border-transparent shadow-sm"
                          title="Select and preview voice sample"
                        >
                          <Play size={14} strokeWidth={2} />
                        </button>
                        <div className="min-w-0">
                          <p className={`text-xs truncate font-sans ${isSelected ? 'font-semibold text-[#F2F2F2]' : 'text-[#F2F2F2]/80 font-medium'}`}>
                            {voice.name}
                          </p>
                          <div className="flex items-center gap-2 mt-0.5">
                            <span className="text-[10px] font-mono text-[#7A7D86]">{voice.lang}</span>
                            <span className="text-[9px] px-1.5 py-0.2 rounded-full bg-[#A78BFA]/15 text-[#C4B5FD] font-mono uppercase font-semibold">
                              ElevenLabs
                            </span>
                            {voice.description && (
                              <span className="text-[10px] text-[#7A7D86]/70 truncate max-w-[160px] font-sans">
                                &bull; {voice.description}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>

                      {isSelected && (
                        <div className="w-5 h-5 rounded-full bg-[#8B7CFF] text-[#FFFFFF] flex items-center justify-center shrink-0 shadow-sm">
                          <Check size={13} strokeWidth={2.5} />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Speech Sliders: Pitch, Rate, Lip-Sync */}
              <div className="bg-[#1A1D27] rounded-[16px] border border-[#23252F] p-4 space-y-4">
                {/* Lip Sync Delay Calibration */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-[#F2F2F2]/90 font-medium font-sans">Lip-Sync Calibration Delay</span>
                    <span className="font-mono text-[#C4B5FD] text-[11px] font-semibold">{lipSyncDelayMs} ms</span>
                  </div>
                  <input
                    type="range"
                    min={60}
                    max={250}
                    step={5}
                    value={lipSyncDelayMs}
                    onChange={(e) => setLipSyncDelayMs(Number(e.target.value))}
                    className="w-full h-1.5 bg-[#181818] rounded-lg appearance-none cursor-pointer accent-[#8B7CFF]"
                  />
                  <p className="text-[10px] text-[#7A7D86]/70 font-sans">
                    Fine-tune phoneme timing with bluetooth or speaker latency. Default is 0ms.
                  </p>
                </div>

                {/* Practice Auto-Repeat Toggle */}
                <div className="flex items-center justify-between pt-3 border-t border-[#2A2C33]">
                  <div>
                    <span className="text-xs font-medium text-[#F2F2F2]/90 block font-sans">Pronunciation Practice</span>
                    <span className="text-[10px] text-[#7A7D86]/70 block font-sans">Repeats user microphone speech automatically</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      const next = !autoRepeat;
                      setAutoRepeat(next);
                      setAgentModeType(next ? 'repeat' : 'agent');
                    }}
                    className={`w-11 h-6 rounded-full transition-colors relative p-0.5 ${
                      autoRepeat ? 'bg-[#8B7CFF]' : 'bg-[#1A1D27] border border-[#23252F]'
                    }`}
                  >
                    <div
                      className={`w-5 h-5 rounded-full bg-white transition-transform ${
                        autoRepeat ? 'translate-x-5' : 'translate-x-0'
                      }`}
                    />
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* ══════════════════════════════════════════════════════════════ */}
          {/* TAB 3: PREFERENCES (Figma Frame 1:102)                      */}
          {/* ══════════════════════════════════════════════════════════════ */}
          {activeTab === 'settings' && (
            <div className="space-y-4 font-sans">
              {/* Header matching Figma Frame 1:102 */}
              <div className="space-y-1 pb-1">
                <h3 className="text-[20px] font-bold text-[#FFFFFF] tracking-tight">Settings</h3>
                <p className="text-[13px] text-[#A7A9AF] leading-relaxed">
                  Every section uses the same dark premium tokens — no second theme.
                </p>
              </div>

              {/* ── 4 Figma Cards (Frame 1:102 / 13:80: Voice, Model, Appearance, Memory & Sessions) ── */}
              <div className="grid grid-cols-1 gap-3.5">
                
                {/* 1. Voice Card (Figma: 520x180 at #1A1D27, Border #2A2E3B) */}
                <div className="p-4 rounded-[16px] bg-[#1A1D27] border border-[#2A2E3B] flex flex-col justify-between gap-3 transition hover:border-[#8B7CFF]/40">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h4 className="text-[15px] font-bold text-[#FFFFFF] tracking-tight">Voice</h4>
                      <p className="text-[12px] text-[#A7A9AF] mt-0.5">Wake word “Aura”  •  Voice switching</p>
                    </div>
                    {/* Figma Toggle Switch (46x26 in #2A2E3B with 18x18 circle in #8B7CFF) */}
                    <button
                      type="button"
                      role="switch"
                      aria-checked={isAlwaysOnMic}
                      onClick={() => auraController.setAlwaysOnMic(!isAlwaysOnMic)}
                      className="w-[46px] h-[26px] rounded-full bg-[#2A2E3B] p-1 flex items-center transition-colors relative shrink-0"
                      title={isAlwaysOnMic ? 'Disable Always-On Mic' : 'Enable Always-On Mic'}
                    >
                      <div
                        className={`w-[18px] h-[18px] rounded-full transition-transform ${
                          isAlwaysOnMic ? 'translate-x-5 bg-[#8B7CFF]' : 'translate-x-0 bg-[#7A7D86]'
                        }`}
                      />
                    </button>
                  </div>
                  <div className="pt-2 border-t border-[#23252F] flex flex-col gap-1 text-[13px] text-[#C9CBD3]">
                    <div className="flex items-center justify-between">
                      <span>Voice: ElevenLabs</span>
                      <span className="text-[11px] text-[#7A7D86] font-mono">Neural HD</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span>Wake word: {isAlwaysOnMic ? 'On' : 'Off'}</span>
                      <span className={`text-[11px] font-medium ${isAlwaysOnMic ? 'text-[#34D399]' : 'text-[#7A7D86]'}`}>
                        {isAlwaysOnMic ? 'Listening' : 'Standby'}
                      </span>
                    </div>
                  </div>
                </div>

                {/* 2. Model Card (Figma: 520x180 at #1A1D27, Border #2A2E3B) */}
                <div className="p-4 rounded-[16px] bg-[#1A1D27] border border-[#2A2E3B] flex flex-col justify-between gap-3 transition hover:border-[#8B7CFF]/40">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h4 className="text-[15px] font-bold text-[#FFFFFF] tracking-tight">Model</h4>
                      <p className="text-[12px] text-[#A7A9AF] mt-0.5">Gemini / Grok  •  Deep Think</p>
                    </div>
                    {/* Toggle Switch */}
                    <button
                      type="button"
                      role="switch"
                      aria-checked={agentSpeed === 'langgraph'}
                      onClick={() => {
                        const nextSpeed = agentSpeed === 'langgraph' ? 'gemini' : 'langgraph';
                        setAgentSpeed(nextSpeed);
                        setAgentModelName(nextSpeed === 'langgraph' ? 'Deep Think' : 'Gemini Pro');
                      }}
                      className="w-[46px] h-[26px] rounded-full bg-[#2A2E3B] p-1 flex items-center transition-colors relative shrink-0"
                      title={agentSpeed === 'langgraph' ? 'Switch to Fast Model' : 'Enable Deep Think'}
                    >
                      <div
                        className={`w-[18px] h-[18px] rounded-full transition-transform ${
                          agentSpeed === 'langgraph' ? 'translate-x-5 bg-[#8B7CFF]' : 'translate-x-0 bg-[#7A7D86]'
                        }`}
                      />
                    </button>
                  </div>
                  <div className="pt-2 border-t border-[#23252F] flex flex-col gap-1 text-[13px] text-[#C9CBD3]">
                    <div className="flex items-center justify-between">
                      <span>Model: {agentSpeed === 'langgraph' ? 'Deep Think' : 'Gemini Pro'}</span>
                      <span className="text-[11px] text-[#7A7D86] font-mono">2.5 Flash</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span>Deep Think: {agentSpeed === 'langgraph' ? 'On' : 'Off'}</span>
                      <span className={`text-[11px] font-medium ${agentSpeed === 'langgraph' ? 'text-[#8B7CFF]' : 'text-[#7A7D86]'}`}>
                        {agentSpeed === 'langgraph' ? 'Multi-Step' : 'Instant'}
                      </span>
                    </div>
                  </div>
                </div>

                {/* 3. Appearance Card (Figma: 520x180 at #1A1D27, Border #2A2E3B) */}
                <div className="p-4 rounded-[16px] bg-[#1A1D27] border border-[#2A2E3B] flex flex-col justify-between gap-3 transition hover:border-[#8B7CFF]/40">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h4 className="text-[15px] font-bold text-[#FFFFFF] tracking-tight">Appearance</h4>
                      <p className="text-[12px] text-[#A7A9AF] mt-0.5">Dark premium  •  Violet accent</p>
                    </div>
                    {/* Fixed Active Switch */}
                    <div
                      className="w-[46px] h-[26px] rounded-full bg-[#2A2E3B] p-1 flex items-center relative shrink-0 cursor-default"
                    >
                      <div className="w-[18px] h-[18px] rounded-full translate-x-5 bg-[#8B7CFF]" />
                    </div>
                  </div>
                  <div className="pt-2 border-t border-[#23252F] flex flex-col gap-1 text-[13px] text-[#C9CBD3]">
                    <div className="flex items-center justify-between">
                      <span>Theme: Dark</span>
                      <span className="text-[11px] text-[#8B7CFF] font-medium">#0B0D12</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span>Accent: Violet</span>
                      <span className="text-[11px] text-[#8B7CFF] font-medium">#8B7CFF</span>
                    </div>
                  </div>
                </div>

                {/* 4. Memory & Sessions Card (Figma: 520x180 at #1A1D27, Border #2A2E3B) */}
                <div className="p-4 rounded-[16px] bg-[#1A1D27] border border-[#2A2E3B] flex flex-col justify-between gap-3 transition hover:border-[#8B7CFF]/40">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h4 className="text-[15px] font-bold text-[#FFFFFF] tracking-tight">Memory & Sessions</h4>
                      <p className="text-[12px] text-[#A7A9AF] mt-0.5">Session history  •  Long-term memory</p>
                    </div>
                    {/* Auto-archive Toggle (Off in Figma) */}
                    <div
                      className="w-[46px] h-[26px] rounded-full bg-[#2A2E3B] p-1 flex items-center relative shrink-0 cursor-default"
                    >
                      <div className="w-[18px] h-[18px] rounded-full translate-x-0 bg-[#7A7D86]" />
                    </div>
                  </div>
                  <div className="pt-2 border-t border-[#23252F] flex flex-col gap-1 text-[13px] text-[#C9CBD3]">
                    <div className="flex items-center justify-between">
                      <span>Auto-archive: Off</span>
                      <span className="text-[11px] text-[#7A7D86]">Retained</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span>Memory: On</span>
                      <span className="text-[11px] text-[#34D399] font-medium">Vector Sync</span>
                    </div>
                  </div>
                </div>

              </div>

              {/* Camera Perspective Quick Controls */}
              <div className="pt-2 flex items-center justify-between px-1">
                <span className="text-[11px] uppercase tracking-wider text-[#7A7D86] font-semibold">Camera View</span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setActiveCamera('wide')}
                    className={`px-3 py-1.5 rounded-[12px] text-xs font-medium transition ${
                      activeCamera === 'wide'
                        ? 'bg-[#8B7CFF] text-[#FFFFFF]'
                        : 'bg-[#1A1D27] text-[#C9CBD3] hover:text-[#FFFFFF] border border-[#2A2E3B]'
                    }`}
                  >
                    Wide
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveCamera('closeup')}
                    className={`px-3 py-1.5 rounded-[12px] text-xs font-medium transition ${
                      activeCamera === 'closeup'
                        ? 'bg-[#8B7CFF] text-[#FFFFFF]'
                        : 'bg-[#1A1D27] text-[#C9CBD3] hover:text-[#FFFFFF] border border-[#2A2E3B]'
                    }`}
                  >
                    Close-up
                  </button>
                </div>
              </div>
            </div>          )}

        </div>
      </div>
    </aside>
    </>
  );
}
