import type { TtsBackend, AvailableBackends, VoiceOption, SynthesisResult } from '@/types';
import { getElevenLabsVoices, synthesizeWithElevenLabs } from './elevenLabsService';

export async function checkAvailableBackends(): Promise<AvailableBackends> {
  try {
    const res = await fetch('/api/status');
    if (!res.ok) throw new Error('Status endpoint failed');
    return await res.json();
  } catch (error) {
    console.warn('Backend proxy unavailable, falling back to false', error);
    return { azure: false, elevenlabs: true };
  }
}

export async function loadVoices(backend: TtsBackend): Promise<VoiceOption[]> {
  if (backend === 'elevenlabs') {
    return await getElevenLabsVoices();
  }
  return [];
}

export async function loadAllCuratedVoices(): Promise<VoiceOption[]> {
  return await loadVoices('elevenlabs');
}

export async function synthesize(text: string, voice: string, backend: TtsBackend = 'elevenlabs', apiKey?: string, modelId?: string, signal?: AbortSignal): Promise<SynthesisResult | null> {
  try {
    return await synthesizeWithElevenLabs(text, voice, apiKey, modelId, signal);
  } catch (error) {
    console.error('TTS synthesis error:', error);
    throw error;
  }
}
