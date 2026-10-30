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
        <div className="h-full bg-[#0D0F17]/95 backdrop-blur-3xl border border-white/[0.08] rounded-[16px] shadow-[0_24px_80px_rgba(0,0,0,0.95),inset_0_1px_1px_rgba(255,255,255,0.08)] flex flex-col overflow-hidden">

          {/* ── 1. Drawer Header ── */}
          <div className="px-5 py-4 border-b border-[#2A2C33] bg-[#181818]/60 flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-full bg-[#202126] border border-[#2A2C33] flex items-center justify-center text-[#A78BFA]">
                <Sparkles size={17} strokeWidth={1.75} />
              </div>
              <div>
                <h2 className="text-[11px] font-semibold tracking-wider uppercase text-[#A7A9AF] font-mono">
                  AI STUDIO
                </h2>
                <p className="text-[11px] text-[#A7A9AF] font-normal tracking-normal">
                  Assistant Telemetry & Studio Controls
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[#131622] border border-[#2A2C33] text-[11px] font-mono text-[#A7A9AF]">
                <span className={agentHealthInfo.connected ? STATUS_DOTS.success : STATUS_DOTS.danger} />
                <span className="tracking-wide">{agentHealthInfo.connected ? 'ONLINE' : 'OFFLINE'}</span>
              </div>

              <button
                type="button"
                onClick={() => {
                  setIsCollapsed(true);
                  setStoreNavTab('home');
                }}
                className="w-8 h-8 rounded-full bg-[#131622] border border-[#2A2C33] flex items-center justify-center text-[#A7A9AF] hover:text-[#F2F2F2] hover:bg-[#202126] active:scale-95 transition shadow-sm"
                title="Close Drawer"
              >
                <X size={15} strokeWidth={1.75} />
              </button>
            </div>
          </div>

          {/* ── 2. Top-Level Tab Switcher ── */}
          <div className="p-3 border-b border-[#2A2C33] bg-[#0D0F17]">
            <div className="grid grid-cols-3 gap-1.5 p-1 bg-[#11131C] border border-[#2A2C33] rounded-full">
              <button
                type="button"
                onClick={() => {
                  setActiveTab('chat');
                  setStoreNavTab('chat');
                  loadHistory();
                }}
                className={`py-2 px-3 rounded-full text-xs font-medium transition-all duration-150 flex items-center justify-center gap-2 active:scale-95 ${
                  activeTab === 'chat' ? 'bg-[#202126] text-[#F2F2F2] font-semibold border border-white/[0.08] shadow-sm'
                    : 'text-[#A7A9AF] hover:text-[#F2F2F2] hover:bg-white/[0.04]'
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
                className={`py-2 px-3 rounded-full text-xs font-medium transition-all duration-150 flex items-center justify-center gap-2 active:scale-95 ${
                  activeTab === 'voice' ? 'bg-[#202126] text-[#F2F2F2] font-semibold border border-white/[0.08] shadow-sm'
                    : 'text-[#A7A9AF] hover:text-[#F2F2F2] hover:bg-white/[0.04]'
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
                className={`py-2 px-3 rounded-full text-xs font-medium transition-all duration-150 flex items-center justify-center gap-2 active:scale-95 ${
                  activeTab === 'settings' ? 'bg-[#202126] text-[#F2F2F2] font-semibold border border-white/[0.08] shadow-sm'
                    : 'text-[#A7A9AF] hover:text-[#F2F2F2] hover:bg-white/[0.04]'
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
              <div className="flex items-center justify-between p-3.5 rounded-[14px] bg-[#131622] border border-[#2A2C33]">
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="w-8 h-8 rounded-full bg-[#A78BFA]/15 border border-[#A78BFA]/25 flex items-center justify-center text-[#A78BFA] shrink-0">
                    <Sparkles size={16} strokeWidth={1.75} />
                  </div>
                  <div className="min-w-0">
                    <h3 className="text-xs font-semibold text-[#F2F2F2] font-sans truncate">
                      ElevenLabs Voice Pack
                    </h3>
                    <p className="text-[10px] text-[#A7A9AF] font-mono">
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
                <Search size={16} strokeWidth={1.5} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[#A7A9AF]" />
                <input
                  type="text"
                  value={voiceSearchQuery}
                  onChange={(e) => setVoiceSearchQuery(e.target.value)}
                  placeholder="Search voices by name or language..."
                  className="w-full bg-[#11131C] border border-[#2A2C33] focus:border-[#A78BFA]/50 focus:ring-1 focus:ring-[#A78BFA]/20 rounded-full pl-10 pr-4 py-2 text-xs md:text-sm text-[#F2F2F2] placeholder-[#A7A9AF] focus:outline-none transition font-sans"
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
                        isSelected ? 'bg-[#202126] border-[#A78BFA]/50 ring-1 ring-[#A78BFA]/20' : 'bg-[#131622] border border-[#2A2C33] hover:border-[#3A3D46] hover:bg-[#202126]'
                      }`}
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleSelectVoice(voice.id);
                          }}
                          className="w-8 h-8 rounded-full bg-[#11131C] hover:bg-[#A78BFA] text-[#A7A9AF] hover:text-[#0B0D12] flex items-center justify-center transition active:scale-90 shrink-0 border border-[#2A2C33] hover:border-transparent shadow-sm"
                          title="Select and preview voice sample"
                        >
                          <Play size={14} strokeWidth={2} />
                        </button>
                        <div className="min-w-0">
                          <p className={`text-xs truncate font-sans ${isSelected ? 'font-semibold text-[#F2F2F2]' : 'text-[#F2F2F2]/80 font-medium'}`}>
                            {voice.name}
                          </p>
                          <div className="flex items-center gap-2 mt-0.5">
                            <span className="text-[10px] font-mono text-[#A7A9AF]">{voice.lang}</span>
                            <span className="text-[9px] px-1.5 py-0.2 rounded-full bg-[#A78BFA]/15 text-[#C4B5FD] font-mono uppercase font-semibold">
                              ElevenLabs
                            </span>
                            {voice.description && (
                              <span className="text-[10px] text-[#A7A9AF]/70 truncate max-w-[160px] font-sans">
                                &bull; {voice.description}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>

                      {isSelected && (
                        <div className="w-5 h-5 rounded-full bg-[#A78BFA] text-[#0B0D12] flex items-center justify-center shrink-0 shadow-sm">
                          <Check size={13} strokeWidth={2.5} />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Speech Sliders: Pitch, Rate, Lip-Sync */}
              <div className="bg-[#131622] rounded-[14px] border border-[#2A2C33] p-4 space-y-4">
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
                    className="w-full h-1.5 bg-[#181818] rounded-lg appearance-none cursor-pointer accent-[#A78BFA]"
                  />
                  <p className="text-[10px] text-[#A7A9AF]/70 font-sans">
                    Fine-tune phoneme timing with bluetooth or speaker latency. Default is 0ms.
                  </p>
                </div>

                {/* Practice Auto-Repeat Toggle */}
                <div className="flex items-center justify-between pt-3 border-t border-[#2A2C33]">
                  <div>
                    <span className="text-xs font-medium text-[#F2F2F2]/90 block font-sans">Pronunciation Practice</span>
                    <span className="text-[10px] text-[#A7A9AF]/70 block font-sans">Repeats user microphone speech automatically</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      const next = !autoRepeat;
                      setAutoRepeat(next);
                      setAgentModeType(next ? 'repeat' : 'agent');
                    }}
                    className={`w-11 h-6 rounded-full transition-colors relative p-0.5 ${
                      autoRepeat ? 'bg-[#A78BFA]' : 'bg-[#11131C] border border-[#2A2C33]'
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
          {/* TAB 3: PREFERENCES (Clean — no tech details exposed)         */}
          {/* ══════════════════════════════════════════════════════════════ */}
          {activeTab === 'settings' && (
            <div className="space-y-5">

              {/* Intelligence Mode */}
              <div className="space-y-3">
                <span className="text-[11px] font-medium uppercase tracking-wider text-[#A7A9AF] font-mono">
                  Intelligence Mode
                </span>
                <div className="grid grid-cols-1 gap-2.5">
                  {[
                    { id: 'gemini' as const, label: 'Balanced', desc: 'Fast and smart — great for most conversations' },
                    { id: 'langgraph' as const, label: 'Deep Think', desc: 'Best for complex problems and detailed analysis' },
                    { id: 'instant' as const, label: 'Lightning', desc: 'Instant responses, works offline' }
                  ].map((mode) => {
                    const isSelected = agentSpeed === mode.id;
                    return (
                      <div
                        key={mode.id}
                        onClick={() => {
                          setAgentSpeed(mode.id);
                          setAgentModelName(mode.label);
                        }}
                        className={`p-3.5 rounded-[14px] border transition cursor-pointer flex items-center justify-between ${
                          isSelected ? 'bg-[#202126] border-[#A78BFA]/50 ring-1 ring-[#A78BFA]/20' : 'bg-[#131622] border border-[#2A2C33] hover:border-[#3A3D46] hover:bg-[#202126]'
                        }`}
                      >
                        <div>
                          <p className={`text-sm font-semibold font-sans ${isSelected ? 'text-[#F2F2F2]' : 'text-[#F2F2F2]/80'}`}>
                            {mode.label}
                          </p>
                          <span className="text-[11px] text-[#A7A9AF]">{mode.desc}</span>
                        </div>
                        {isSelected && (
                          <div className="w-5 h-5 rounded-full bg-[#A78BFA] text-[#0B0D12] flex items-center justify-center shrink-0">
                            <Check size={13} strokeWidth={2.5} />
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Always-On Microphone Setting */}
              <div className="bg-[#131622] rounded-[14px] border border-[#2A2C33] p-4 flex items-center justify-between">
                <div>
                  <span className="text-xs font-semibold text-[#F2F2F2] block font-sans">
                    Always-On Microphone
                  </span>
                  <span className="text-[11px] text-[#A7A9AF]/70 block font-sans mt-0.5">
                    Continuous hands-free conversation with intelligent feedback suppression
                  </span>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={isAlwaysOnMic}
                  onClick={() => auraController.setAlwaysOnMic(!isAlwaysOnMic)}
                  className={`w-11 h-6 rounded-full transition-colors relative p-0.5 shrink-0 ${
                    isAlwaysOnMic ? 'bg-[#A78BFA]' : 'bg-[#11131C] border border-[#2A2C33]'
                  }`}
                  title={isAlwaysOnMic ? 'Disable Always-On Mic' : 'Enable Always-On Mic'}
                >
                  <div
                    className={`w-5 h-5 rounded-full bg-white transition-transform ${
                      isAlwaysOnMic ? 'translate-x-5' : 'translate-x-0'
                    }`}
                  />
                </button>
              </div>

              {/* Camera View */}
              <div className="space-y-3">
                <span className="text-[11px] font-medium uppercase tracking-wider text-[#A7A9AF] font-mono">
                  Camera View
                </span>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => setActiveCamera('wide')}
                    className={`py-2.5 px-3 rounded-full border text-xs font-medium flex items-center justify-center gap-2 transition active:scale-95 ${
                      activeCamera === 'wide' ? 'bg-[#202126] text-[#F2F2F2] font-semibold border border-white/[0.12] shadow-sm' : 'bg-[#131622] border border-[#2A2C33] text-[#A7A9AF] hover:text-[#F2F2F2] hover:border-[#3A3D46]'
                    }`}
                  >
                    <Maximize2 size={15} strokeWidth={1.5} />
                    <span>Wide View</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setActiveCamera('closeup')}
                    className={`py-2.5 px-3 rounded-full border text-xs font-medium flex items-center justify-center gap-2 transition active:scale-95 ${
                      activeCamera === 'closeup' ? 'bg-[#202126] text-[#F2F2F2] font-semibold border border-white/[0.12] shadow-sm' : 'bg-[#131622] border border-[#2A2C33] text-[#A7A9AF] hover:text-[#F2F2F2] hover:border-[#3A3D46]'
                    }`}
                  >
                    <Focus size={15} strokeWidth={1.5} />
                    <span>Close-up</span>
                  </button>
                </div>
              </div>

              {/* Status — clean, no model/DB info */}
              <div className="bg-[#131622] rounded-[14px] border border-[#2A2C33] p-4 space-y-0 text-xs">
                <div className="flex items-center justify-between py-2.5 border-b border-[#2A2C33]">
                  <span className="text-[#A7A9AF] font-sans">Assistant Status</span>
                  <span className="text-emerald-400 font-medium">Online & Ready</span>
                </div>
                <div className="flex items-center justify-between py-2.5 border-b border-[#2A2C33]">
                  <span className="text-[#A7A9AF] font-sans">Memory</span>
                  <span className="text-[#F2F2F2] font-mono">Active</span>
                </div>
                <div className="flex items-center justify-between py-2.5">
                  <span className="text-[#A7A9AF] font-sans">Voice Synthesis</span>
                  <span className="text-[#F2F2F2] font-mono">Neural HD</span>
                </div>
              </div>

            </div>
          )}

        </div>
      </div>
    </aside>
    </>
  );
}
