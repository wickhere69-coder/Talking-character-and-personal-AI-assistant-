import { create } from 'zustand';
import type { AppState, TtsBackend, PlaybackState, CameraPreset, VoiceOption, AvailableBackends, VisemeFrame } from '@/types';

export const useAppStore = create<AppState>((set) => ({
  scriptText: '',
  ttsBackend: 'webSpeech',
  availableBackends: { azure: false, elevenlabs: false },
  playbackState: 'idle',
  selectedVoice: '',
  voices: [],
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
    ? Number(localStorage.getItem('talking_character_lipsync_delay') ?? 120) 
    : 120,
  isListening: false,
  autoRepeat: false,
  agentMode: true,
  agentModeType: 'agent',
  agentSpeed: 'grok',
  agentStatus: 'idle',
  currentAgentAction: null,
  pendingConfirmation: null,
  agentModelName: 'Grok 4.6 (xAI)',
  activeTaskSteps: [],
  isHistoryModalOpen: false,
  lastFullResponse: '',
  isFullResponseModalOpen: false,
  error: null,

  setScriptText: (scriptText) => set({ scriptText }),
  setTtsBackend: (ttsBackend) => set({ ttsBackend }),
  setAvailableBackends: (availableBackends) => set({ availableBackends }),
  setPlaybackState: (playbackState) => set({ playbackState }),
  setSelectedVoice: (selectedVoice) => set({ selectedVoice }),
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
  setAutoRepeat: (autoRepeat) => set({ autoRepeat }),
  setAgentMode: (agentMode) => set({ agentMode }),
  setAgentModeType: (agentModeType) => set({ 
    agentModeType, 
    agentMode: agentModeType !== 'repeat' 
  }),
  setAgentSpeed: (agentSpeed) => set({ agentSpeed }),
  setAgentStatus: (agentStatus) => set({ agentStatus }),
  setCurrentAgentAction: (currentAgentAction) => set({ currentAgentAction }),
  setPendingConfirmation: (pendingConfirmation) => set({ pendingConfirmation }),
  setAgentModelName: (agentModelName) => set({ agentModelName }),
  setActiveTaskSteps: (activeTaskSteps) => set({ activeTaskSteps }),
  setIsHistoryModalOpen: (isHistoryModalOpen) => set({ isHistoryModalOpen }),
  setLastFullResponse: (lastFullResponse) => set({ lastFullResponse }),
  setIsFullResponseModalOpen: (isFullResponseModalOpen) => set({ isFullResponseModalOpen }),
  setError: (error) => set({ error }),
}));
