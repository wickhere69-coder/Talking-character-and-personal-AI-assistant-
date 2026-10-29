import { create } from 'zustand';
import type { AppState, TtsBackend, PlaybackState, CameraPreset, VoiceOption, AvailableBackends, VisemeFrame } from '@/types';
import { ELEVENLABS_VOICE_PACK } from '@/services/elevenLabsService';

export const useAppStore = create<AppState>((set) => ({
  scriptText: '',
  ttsBackend: 'elevenlabs',
  availableBackends: { azure: false, elevenlabs: true },
  playbackState: 'idle',
  selectedVoice: typeof window !== 'undefined'
    ? (() => {
        const saved = localStorage.getItem('talking_character_selected_voice');
        // If saved voice was previously Bella or Jenny or not set, default to Lily
        if (!saved || saved === 'hpp4J3VqNfWAUOO0d1Us' || saved === 'en-US-JennyNeural') {
          try { localStorage.setItem('talking_character_selected_voice', 'pFZP5JQG7iQjIQuC4Bku'); } catch {}
          return 'pFZP5JQG7iQjIQuC4Bku';
        }
        return ELEVENLABS_VOICE_PACK.some(v => v.id === saved) ? saved : 'pFZP5JQG7iQjIQuC4Bku';
      })()
    : 'pFZP5JQG7iQjIQuC4Bku',
  voices: ELEVENLABS_VOICE_PACK,
  activeCamera: 'wide',
  sceneTheme: 'creator_loft',
  customGlbUrl: null,
  visemeQueue: [],
  audioUrl: null,
  audioMode: 'tts',
  currentWordIndex: -1,
  isSpeaking: false,
  speechText: '',
  activeCharIndex: 0,
  lipSyncDelayMs: typeof window !== 'undefined' 
    ? (() => {
        const saved = localStorage.getItem('talking_character_lipsync_delay');
        if (!saved || saved === '120') {
          try { localStorage.setItem('talking_character_lipsync_delay', '0'); } catch {}
          return 0;
        }
        return Number(saved) || 0;
      })() 
    : 0,
  isListening: false,
  isAlwaysOnMic: typeof window !== 'undefined'
    ? localStorage.getItem('talking_character_always_on_mic') === 'true'
    : false,
  autoRepeat: false,
  agentMode: true,
  agentModeType: 'agent',
  isConversationalActive: false,
  agentSpeed: 'gemini',
  agentStatus: 'idle',
  currentAgentAction: null,
  pendingConfirmation: null,
  agentModelName: 'Google Gemini 3.5 Flash',
  activeTaskSteps: [],
  isHistoryModalOpen: false,
  lastFullResponse: '',
  isFullResponseModalOpen: false,
  activeNavTab: 'home',
  isControlPanelCollapsed: true,
  isDarkTheme: true,
  auraState: 'sleeping',
  setAuraState: (auraState) => set({ auraState }),

  error: null,

  setScriptText: (scriptText) => set({ scriptText }),
  setTtsBackend: (ttsBackend) => set({ ttsBackend }),
  setAvailableBackends: (availableBackends) => set({ availableBackends }),
  setPlaybackState: (playbackState) => set({ playbackState }),
  setSelectedVoice: (selectedVoice) => {
    if (typeof window !== 'undefined') {
      try {
        localStorage.setItem('talking_character_selected_voice', selectedVoice);
      } catch {}
    }
    set({ selectedVoice });
  },
  setVoices: (voices) => set({ voices }),
  setActiveCamera: (activeCamera) => set({ activeCamera }),
  setSceneTheme: (sceneTheme) => set({ sceneTheme }),
  setCustomGlbUrl: (customGlbUrl) => set({ customGlbUrl }),
  setVisemeQueue: (visemeQueue) => set({ visemeQueue }),
  setAudioUrl: (audioUrl) => set({ audioUrl }),
  setAudioMode: (audioMode) => set({ audioMode }),
  setCurrentWordIndex: (currentWordIndex) => set({ currentWordIndex }),
  setIsSpeaking: (isSpeaking) => set({ isSpeaking }),
  setSpeechText: (speechText) => set({ speechText }),
  setActiveCharIndex: (activeCharIndex) => set({ activeCharIndex }),
  setLipSyncDelayMs: (lipSyncDelayMs) => {
    if (typeof window !== 'undefined') {
      try { localStorage.setItem('talking_character_lipsync_delay', String(lipSyncDelayMs)); } catch {}
    }
    set({ lipSyncDelayMs });
  },
  setIsListening: (isListening) => set({ isListening }),
  setIsAlwaysOnMic: (isAlwaysOnMic) => {
    if (typeof window !== 'undefined') {
      try { localStorage.setItem('talking_character_always_on_mic', String(isAlwaysOnMic)); } catch {}
    }
    set({ isAlwaysOnMic });
  },
  setAutoRepeat: (autoRepeat) => set({ autoRepeat }),
  setAgentMode: (agentMode) => set({ agentMode }),
  setAgentModeType: (agentModeType) => set({ 
    agentModeType, 
    agentMode: agentModeType !== 'repeat' 
  }),
  setIsConversationalActive: (isConversationalActive) => set({ isConversationalActive }),
  setAgentSpeed: (agentSpeed) => set({ agentSpeed }),
  setAgentStatus: (agentStatus) => set({ agentStatus }),
  setCurrentAgentAction: (currentAgentAction) => set({ currentAgentAction }),
  setPendingConfirmation: (pendingConfirmation) => set({ pendingConfirmation }),
  setAgentModelName: (agentModelName) => set({ agentModelName }),
  setActiveTaskSteps: (activeTaskSteps) => set({ activeTaskSteps }),
  setIsHistoryModalOpen: (isHistoryModalOpen) => set({ isHistoryModalOpen }),
  setLastFullResponse: (lastFullResponse) => set({ lastFullResponse }),
  setIsFullResponseModalOpen: (isFullResponseModalOpen) => set({ isFullResponseModalOpen }),
  setActiveNavTab: (activeNavTab) => set({
    activeNavTab,
    isControlPanelCollapsed: activeNavTab === 'home'
  }),
  setIsControlPanelCollapsed: (isControlPanelCollapsed) => set({ isControlPanelCollapsed }),
  setIsDarkTheme: (isDarkTheme) => {
    if (typeof document !== 'undefined') {
      document.documentElement.classList.toggle('light', !isDarkTheme);
    }
    set({ isDarkTheme });
  },
  setError: (error) => set({ error }),

  // Human Behavior / Emotion
  currentEmotion: { primary: 'neutral', intensity: 0.3, secondary: null },
  setCurrentEmotion: (currentEmotion) => set({ currentEmotion }),
  currentSentence: '',
  setCurrentSentence: (currentSentence) => set({ currentSentence }),
}));
