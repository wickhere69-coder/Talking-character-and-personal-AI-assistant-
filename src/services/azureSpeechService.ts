import type { VoiceOption, SynthesisResult } from '@/types';

export const NEURAL_FEMALE_VOICES: VoiceOption[] = [
  {
    id: 'en-US-JennyNeural',
    name: 'Jenny (Neural)',
    lang: 'en-US',
    backend: 'azure',
    gender: 'female',
    description: 'Natural, warm and expressive American female voice'
  },
  {
    id: 'en-US-AriaNeural',
    name: 'Aria (Neural)',
    lang: 'en-US',
    backend: 'azure',
    gender: 'female',
    description: 'Engaging, confident conversational American female'
  },
  {
    id: 'en-US-AvaNeural',
    name: 'Ava (Neural)',
    lang: 'en-US',
    backend: 'azure',
    gender: 'female',
    description: 'Bright, playful and friendly American female'
  },
  {
    id: 'en-US-EmmaNeural',
    name: 'Emma (Neural)',
    lang: 'en-US',
    backend: 'azure',
    gender: 'female',
    description: 'Crisp, articulate professional American female'
  },
  {
    id: 'en-US-MichelleNeural',
    name: 'Michelle (Neural)',
    lang: 'en-US',
    backend: 'azure',
    gender: 'female',
    description: 'Smooth, warm and melodic American female'
  },
  {
    id: 'en-US-AnaNeural',
    name: 'Ana (Neural)',
    lang: 'en-US',
    backend: 'azure',
    gender: 'female',
    description: 'Sweet, gentle and youthful American female'
  },
  {
    id: 'en-GB-SoniaNeural',
    name: 'Sonia (Neural)',
    lang: 'en-GB',
    backend: 'azure',
    gender: 'female',
    description: 'Polished, elegant British English female'
  },
  {
    id: 'en-AU-NatashaNeural',
    name: 'Natasha (Neural)',
    lang: 'en-AU',
    backend: 'azure',
    gender: 'female',
    description: 'Warm, lively Australian English female'
  }
];

export async function getAzureVoices(): Promise<VoiceOption[]> {
  return NEURAL_FEMALE_VOICES;
}

export async function synthesizeWithAzure(text: string, voiceName: string, signal?: AbortSignal): Promise<SynthesisResult> {
  const res = await fetch('/api/synthesize', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, voice: voiceName }),
    signal
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Neural speech synthesis failed');
  }

  const data = await res.json();
  if (!data.audioBase64) {
    throw new Error('No audio returned from neural synthesis');
  }

  const binaryString = window.atob(data.audioBase64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  const audioBlob = new Blob([bytes], { type: 'audio/mp3' });
  const audioUrl = URL.createObjectURL(audioBlob);

  return { audioBlob, audioUrl, visemes: data.visemes || [] };
}
