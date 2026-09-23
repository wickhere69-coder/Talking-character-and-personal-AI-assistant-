// ── TTS Backend Types ──

export type TtsBackend = 'webSpeech' | 'azure' | 'elevenlabs';

export type PlaybackState = 'idle' | 'loading' | 'playing' | 'paused';

export type CameraPreset = 'wide' | 'closeup';

export interface VoiceOption {
  id: string;
  name: string;
  lang: string;
  backend: TtsBackend;
  previewUrl?: string;
  description?: string;
  sampleText?: string;
  pitch?: number;
  rate?: number;
  gender?: 'female' | 'male' | 'neutral';
}

export interface AvailableBackends {
  azure: boolean;
  elevenlabs: boolean;
}

// ── Viseme Types ──

export interface VisemeFrame {
  timeMs: number;
  audioOffset: number; // alias for timeMs, used by lip sync engine
  visemeId: number;
  weights?: Record<string, number>;
}

export interface VisemeMapping {
  [shapeName: string]: number;
}

// ── Phoneme Types ──

export type ARPAbetPhoneme =
  | 'AA' | 'AE' | 'AH' | 'AO' | 'AW' | 'AY'
  | 'B' | 'CH' | 'D' | 'DH'
  | 'EH' | 'ER' | 'EY'
  | 'F' | 'G' | 'HH'
  | 'IH' | 'IY'
  | 'JH' | 'K' | 'L' | 'M' | 'N' | 'NG'
  | 'OW' | 'OY'
  | 'P' | 'R' | 'S' | 'SH'
  | 'T' | 'TH'
  | 'UH' | 'UW'
  | 'V' | 'W' | 'Y' | 'Z' | 'ZH'
  | 'SIL';

export type OculusViseme =
  | 'viseme_sil' | 'viseme_PP' | 'viseme_FF' | 'viseme_TH'
  | 'viseme_DD' | 'viseme_kk' | 'viseme_CH' | 'viseme_SS'
  | 'viseme_nn' | 'viseme_RR' | 'viseme_aa' | 'viseme_E'
  | 'viseme_I' | 'viseme_O' | 'viseme_U';

// ── TTS Service Types ──

export interface SynthesisResult {
  audioBlob: Blob;
  audioUrl: string;
  visemes: VisemeFrame[];
}

export interface WordBoundary {
  word: string;
  charIndex: number;
  startTimeMs: number;
  endTimeMs: number;
}

// ── App Store Types ──

export interface AppState {
  // Script
  scriptText: string;
  setScriptText: (text: string) => void;

  // TTS Backend
  ttsBackend: TtsBackend;
  setTtsBackend: (b: TtsBackend) => void;
  availableBackends: AvailableBackends;
  setAvailableBackends: (b: AvailableBackends) => void;

  // Playback
  playbackState: PlaybackState;
  setPlaybackState: (s: PlaybackState) => void;

  // Voice
  selectedVoice: string;
  setSelectedVoice: (v: string) => void;
  voices: VoiceOption[];
  setVoices: (v: VoiceOption[]) => void;

  // Camera
  activeCamera: CameraPreset;
  setActiveCamera: (c: CameraPreset) => void;

  // Environment & Background Theme
  sceneTheme: 'creator_loft' | 'broadcast_studio' | 'custom_glb';
  setSceneTheme: (t: 'creator_loft' | 'broadcast_studio' | 'custom_glb') => void;
  customGlbUrl: string | null;
  setCustomGlbUrl: (url: string | null) => void;

  // Lip sync data
  visemeQueue: VisemeFrame[];
  setVisemeQueue: (q: VisemeFrame[]) => void;

  // Audio
  audioUrl: string | null;
  setAudioUrl: (url: string | null) => void;
  audioMode: 'tts' | 'file';
  setAudioMode: (m: 'tts' | 'file') => void;

  // Word tracking
  currentWordIndex: number;
  setCurrentWordIndex: (i: number) => void;

  // Speaking & Speech Sync
  isSpeaking: boolean;
  setIsSpeaking: (s: boolean) => void;
  speechText: string;
  setSpeechText: (text: string) => void;
  activeCharIndex: number;
  setActiveCharIndex: (idx: number) => void;
  lipSyncDelayMs: number;
  setLipSyncDelayMs: (delay: number) => void;

  // Speech Recognition / Voice Repeat
  isListening: boolean;
  setIsListening: (listening: boolean) => void;
  autoRepeat: boolean;
  setAutoRepeat: (repeat: boolean) => void;

  // AI Assistant / Agent State
  agentMode: boolean;
  setAgentMode: (mode: boolean) => void;
  agentModeType: 'agent' | 'chat' | 'repeat' | 'conversational';
  setAgentModeType: (mode: 'agent' | 'chat' | 'repeat' | 'conversational') => void;
  isConversationalActive: boolean;
  setIsConversationalActive: (active: boolean) => void;
  agentSpeed: 'instant' | 'grok' | 'gemini';
  setAgentSpeed: (speed: 'instant' | 'grok' | 'gemini') => void;
  agentStatus: 'idle' | 'listening' | 'thinking' | 'planning' | 'executing_tool' | 'speaking' | 'completed' | 'error' | 'awaiting_confirmation';
  setAgentStatus: (status: 'idle' | 'listening' | 'thinking' | 'planning' | 'executing_tool' | 'speaking' | 'completed' | 'error' | 'awaiting_confirmation') => void;
  currentAgentAction: string | null;
  setCurrentAgentAction: (action: string | null) => void;
  pendingConfirmation: {
    id: string;
    toolName: string;
    description: string;
    parameters: Record<string, any>;
  } | null;
  setPendingConfirmation: (conf: { id: string; toolName: string; description: string; parameters: Record<string, any> } | null) => void;
  agentModelName: string;
  setAgentModelName: (name: string) => void;
  activeTaskSteps: Array<{ title: string; status: 'pending' | 'in_progress' | 'completed' | 'failed' }>;
  setActiveTaskSteps: (steps: Array<{ title: string; status: 'pending' | 'in_progress' | 'completed' | 'failed' }>) => void;
  isHistoryModalOpen: boolean;
  setIsHistoryModalOpen: (open: boolean) => void;
  lastFullResponse: string;
  setLastFullResponse: (text: string) => void;
  isFullResponseModalOpen: boolean;
  setIsFullResponseModalOpen: (open: boolean) => void;

  // Error
  error: string | null;
  setError: (e: string | null) => void;
}

