import type { VoiceOption, SynthesisResult, VisemeFrame } from '@/types';

export const ELEVENLABS_VOICE_PACK: VoiceOption[] = [
  {
    id: 'hpp4J3VqNfWAUOO0d1Us',
    name: 'Bella (ElevenLabs)',
    lang: 'en-US',
    backend: 'elevenlabs',
    gender: 'female',
    pitch: 1.1,
    rate: 1.0,
    previewUrl: '/voices/elevenlabs/bella.mp3',
    description: 'Warm, Bright, Professional US English',
    sampleText: 'This voice is warm, bright, and professional, characterized by a Standard American accent and a polished narrative quality.'
  },
  {
    id: 'cgSgspJ2msm6clMCkdW9',
    name: 'Jessica (ElevenLabs)',
    lang: 'en-US',
    backend: 'elevenlabs',
    gender: 'female',
    pitch: 1.25,
    rate: 1.06,
    previewUrl: '/voices/elevenlabs/jessica.mp3',
    description: 'Playful, Bright, Warm US English',
    sampleText: 'Young and popular, this playful American female voice is perfect for trendy, upbeat social media content.'
  },
  {
    id: 'Xb7hH8MSUJpSbSDYk0k2',
    name: 'Alice (ElevenLabs)',
    lang: 'en-GB',
    backend: 'elevenlabs',
    gender: 'female',
    pitch: 1.05,
    rate: 0.96,
    previewUrl: '/voices/elevenlabs/alice.mp3',
    description: 'Clear, Engaging British Educator',
    sampleText: 'Clear and engaging, friendly woman with a British accent suitable for e-learning and educational presentations.'
  },
  {
    id: 'pFZP5JQG7iQjIQuC4Bku',
    name: 'Lily (ElevenLabs)',
    lang: 'en-GB',
    backend: 'elevenlabs',
    gender: 'female',
    pitch: 0.95,
    rate: 0.92,
    previewUrl: '/voices/elevenlabs/lily.mp3',
    description: 'Velvety, Warm British Narrator',
    sampleText: 'Velvety British female voice delivers news, documentaries, and narrations with warmth and crystal clarity.'
  },
  {
    id: 'XrExE9yKIg1WjnnlVkGX',
    name: 'Matilda (ElevenLabs)',
    lang: 'en-US',
    backend: 'elevenlabs',
    gender: 'female',
    pitch: 0.88,
    rate: 1.0,
    previewUrl: '/voices/elevenlabs/matilda.mp3',
    description: 'Knowledgeable, Professional US Alto',
    sampleText: 'A professional woman with a pleasing alto pitch, suitable for commercial, broadcast, and educational presentations.'
  },
  {
    id: 'EXAVITQu4vr4xnSDxMaL',
    name: 'Sarah (ElevenLabs)',
    lang: 'en-US',
    backend: 'elevenlabs',
    gender: 'female',
    pitch: 0.94,
    rate: 0.98,
    previewUrl: '/voices/elevenlabs/sarah.mp3',
    description: 'Mature, Reassuring, Confident US English',
    sampleText: 'Mature, reassuring, and confident voice ready to narrate your audiobooks, tutorials, and broadcast stories.'
  }
];

export async function getElevenLabsVoices(): Promise<VoiceOption[]> {
  try {
    const res = await fetch('/api/voices?backend=elevenlabs');
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data) && data.length > 0) {
        const maleKeywords = ['guy', 'david', 'george', 'mark', 'richard', 'brian', 'male', 'paul', 'james', 'alex', 'daniel', 'adam', 'charlie', 'callum'];
        return data.filter((v: any) => {
          const combined = (v.name || '').toLowerCase();
          return !maleKeywords.some(k => combined.includes(k));
        });
      }
    }
  } catch (error) {
    console.warn('Failed to fetch elevenlabs voices from proxy, using curated voice pack', error);
  }

  return ELEVENLABS_VOICE_PACK;
}

function estimateVisemesFromAlignment(characters: string[], startTimes: number[], endTimes: number[]): VisemeFrame[] {
  const visemes: VisemeFrame[] = [];
  
  // Very rough mapping of characters to Oculus viseme IDs (0-14 approx)
  const charToViseme: Record<string, number> = {
    'a': 1, 'e': 2, 'i': 3, 'o': 4, 'u': 5,
    'p': 21, 'b': 21, 'm': 21, // bilabial
    'f': 18, 'v': 18, // labiodental
    't': 19, 'd': 19, 's': 15, 'z': 15, // alveolar
    'c': 15, 'k': 20, 'g': 20, // velar
    'n': 19, 'r': 14, 'l': 14,
    'w': 7, 'y': 3, 'h': 1,
    ' ': 0 // sil
  };

  for (let i = 0; i < characters.length; i++) {
    const char = characters[i].toLowerCase();
    const startTimeMs = startTimes[i] * 1000;
    const visemeId = charToViseme[char] || 0;
    
    visemes.push({
      timeMs: startTimeMs,
      audioOffset: startTimeMs,
      visemeId: visemeId
    });
  }

  return visemes;
}

export async function synthesizeWithElevenLabs(
  text: string, 
  voiceId: string, 
  apiKey?: string, 
  modelId: string = 'eleven_multilingual_v2',
  signal?: AbortSignal
): Promise<SynthesisResult> {
  const key = apiKey || (typeof window !== 'undefined' ? localStorage.getItem('elevenlabs_api_key') || '' : '');
  const res = await fetch('/api/elevenlabs', {
    method: 'POST',
    headers: { 
      'Content-Type': 'application/json',
      ...(key ? { 'xi-api-key': key } : {})
    },
    body: JSON.stringify({ text, voiceId, apiKey: key, modelId }),
    signal
  });

  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(errData.error || 'ElevenLabs synthesis failed');
  }

  const data = await res.json();
  
  // Decode base64 audio
  const base64Str = data.audio_base64 || data.audioBase64;
  if (!base64Str) {
    throw new Error('No audio returned from ElevenLabs');
  }

  const binaryString = window.atob(base64Str);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  const audioBlob = new Blob([bytes], { type: 'audio/mp3' });
  const audioUrl = URL.createObjectURL(audioBlob);

  const alignment = data.alignment || {};
  let visemes: VisemeFrame[] = [];
  
  if (alignment.characters && alignment.character_start_times_seconds && alignment.character_end_times_seconds) {
    visemes = estimateVisemesFromAlignment(
      alignment.characters,
      alignment.character_start_times_seconds,
      alignment.character_end_times_seconds
    );
  }

  return { audioBlob, audioUrl, visemes };
}

export async function saveElevenLabsKey(apiKey: string): Promise<boolean> {
  try {
    if (apiKey && apiKey.trim()) {
      localStorage.setItem('elevenlabs_api_key', apiKey.trim());
    } else {
      localStorage.removeItem('elevenlabs_api_key');
    }
    const res = await fetch('/api/save-elevenlabs-key', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apiKey: apiKey.trim() })
    });
    return res.ok;
  } catch (e) {
    console.warn('Could not save key to backend', e);
    return false;
  }
}

