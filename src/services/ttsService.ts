import type { TtsBackend, AvailableBackends, VoiceOption, SynthesisResult } from '@/types';
import { getWebSpeechVoices, getAllCategorizedVoices } from './webSpeechService';
import { getAzureVoices, synthesizeWithAzure } from './azureSpeechService';
import { getElevenLabsVoices, synthesizeWithElevenLabs } from './elevenLabsService';

export async function checkAvailableBackends(): Promise<AvailableBackends> {
  try {
    const res = await fetch('/api/status');
    if (!res.ok) throw new Error('Status endpoint failed');
    return await res.json();
  } catch (error) {
    console.warn('Backend proxy unavailable, falling back to false', error);
    return { azure: false, elevenlabs: false };
  }
}

export async function loadVoices(backend: TtsBackend): Promise<VoiceOption[]> {
  switch (backend) {
    case 'webSpeech': {
      const allVoices = await getWebSpeechVoices();
      if (allVoices.length === 0) return [];

      const categorized = getAllCategorizedVoices(allVoices);
      
      // Strictly female voices, preferring English
      const enVoices = categorized.filter((c) => c.voice.lang.toLowerCase().startsWith('en'));
      const otherVoices = categorized.filter((c) => !c.voice.lang.toLowerCase().startsWith('en'));
      const sorted = [...enVoices, ...otherVoices];

      const baseOptions: VoiceOption[] = [];

      for (const item of sorted) {
        const v = item.voice;
        baseOptions.push({
          id: v.voiceURI,
          name: `${item.displayName} (Female)`,
          lang: v.lang,
          backend: 'webSpeech',
          gender: 'female',
          pitch: 1.0,
          rate: 1.0,
          description: `Natural browser female voice (${v.lang})`
        });
      }

      // Add distinctive female personality voice presets so user has distinct tone options
      if (baseOptions.length > 0) {
        const primary = baseOptions[0];
        const cleanName = primary.name.split(' (')[0];
        baseOptions.push({
          id: `${primary.id}::bright`,
          name: `${cleanName} (Playful & Bright)`,
          lang: primary.lang,
          backend: 'webSpeech',
          gender: 'female',
          pitch: 1.25,
          rate: 1.06,
          description: 'High-pitch, cheerful and youthful female tone'
        });
        baseOptions.push({
          id: `${primary.id}::sweet`,
          name: `${cleanName} (Sweet & Soft)`,
          lang: primary.lang,
          backend: 'webSpeech',
          gender: 'female',
          pitch: 1.14,
          rate: 0.98,
          description: 'Gentle, friendly female voice'
        });
        baseOptions.push({
          id: `${primary.id}::warm`,
          name: `${cleanName} (Warm & Calm)`,
          lang: primary.lang,
          backend: 'webSpeech',
          gender: 'female',
          pitch: 0.92,
          rate: 0.94,
          description: 'Warm, relaxed narrative female tone'
        });
        baseOptions.push({
          id: `${primary.id}::confident`,
          name: `${cleanName} (Confident Alto)`,
          lang: primary.lang,
          backend: 'webSpeech',
          gender: 'female',
          pitch: 0.85,
          rate: 1.02,
          description: 'Rich, confident professional female alto'
        });
      }

      return baseOptions;
    }
    case 'azure':
      return await getAzureVoices();
    case 'elevenlabs':
      return await getElevenLabsVoices();
    default:
      return [];
  }
}

export async function loadAllCuratedVoices(): Promise<VoiceOption[]> {
  const [neuralVoices, webVoices, elevenVoices] = await Promise.all([
    loadVoices('azure'),
    loadVoices('webSpeech'),
    loadVoices('elevenlabs')
  ]);
  return [...neuralVoices, ...elevenVoices, ...webVoices];
}

export async function synthesize(text: string, voice: string, backend: TtsBackend, apiKey?: string, modelId?: string, signal?: AbortSignal): Promise<SynthesisResult | null> {
  try {
    if (backend === 'azure') {
      return await synthesizeWithAzure(text, voice, signal);
    } else if (backend === 'elevenlabs') {
      return await synthesizeWithElevenLabs(text, voice, apiKey, modelId, signal);
    } else if (backend === 'webSpeech') {
      return null;
    }
    return null;
  } catch (error) {
    console.error('TTS synthesis error:', error);
    throw error;
  }
}
