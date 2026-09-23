import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import axios from 'axios';
import fs from 'fs';
import path from 'path';
import * as SpeechSDK from 'microsoft-cognitiveservices-speech-sdk';
import { MsEdgeTTS, OUTPUT_FORMAT } from 'msedge-tts';
import { createAgentRouter } from './agent/routes';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

const PORT = process.env.PORT || 3001;
const AZURE_KEY = process.env.AZURE_SPEECH_KEY || '';
const AZURE_REGION = process.env.AZURE_SPEECH_REGION || 'eastus';
let ELEVENLABS_KEY = process.env.ELEVENLABS_API_KEY || '';

app.get('/api/status', (req, res) => {
  res.json({
    azure: true,
    elevenlabs: !!ELEVENLABS_KEY
  });
});

// Process-level safeguards to keep the Express server permanently resilient against network drops
process.on('uncaughtException', (err: any) => {
  console.warn('[SERVER UNCAUGHT EXCEPTION SAFEGUARD]:', err?.message || err);
});
process.on('unhandledRejection', (reason: any) => {
  console.warn('[SERVER UNHANDLED REJECTION SAFEGUARD]:', reason);
});

const ttsAudioCache = new Map<string, Buffer>();
const MAX_CACHE_ENTRIES = 120;
const ttsClients = new Map<string, MsEdgeTTS>();

async function getEdgeTtsClient(voice: string): Promise<MsEdgeTTS> {
  let client = ttsClients.get(voice);
  if (!client) {
    client = new MsEdgeTTS();
    await client.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);
    ttsClients.set(voice, client);
  }
  return client;
}

// Pre-warm neural studio voices for instant zero-latency "Hey there."
setTimeout(async () => {
  try {
    const prewarmVoices = [
      'en-US-JennyNeural',
      'en-US-AriaNeural',
      'en-US-AvaNeural',
      'en-US-EmmaNeural',
      'en-US-MichelleNeural',
      'en-US-AnaNeural',
      'en-GB-SoniaNeural',
      'en-AU-NatashaNeural'
    ];
    for (const v of prewarmVoices) {
      try {
        const client = await getEdgeTtsClient(v);
        const res = client.toStream('Hey there.');
        const chunks: Buffer[] = [];
        res.audioStream.on('data', c => chunks.push(c));
        res.audioStream.on('end', () => {
          const buf = Buffer.concat(chunks);
          ttsAudioCache.set(`${v}:Hey there.`, buf);
          ttsAudioCache.set(`${v}:Hey there`, buf);
          console.log(`[TTS PRE-WARMED] ${v} ready with instant "Hey there."`);
        });
        res.audioStream.on('error', () => {
          ttsClients.delete(v);
        });
      } catch (err) {
        ttsClients.delete(v);
        console.warn(`[TTS PRE-WARMED] Notice on ${v}:`, err);
      }
    }
  } catch (e) {
    console.warn('Notice during TTS pre-warm:', e);
  }
}, 1000);

app.get('/api/tts-stream', async (req, res) => {
  const text = (req.query.text as string || '').trim();
  const voice = (req.query.voice as string) || 'en-US-JennyNeural';
  const rate = (req.query.rate as string) || '+3%';
  const pitch = (req.query.pitch as string) || '+1Hz';
  if (!text) {
    return res.status(400).send('Text is required');
  }

  const cacheKey = `${voice}:${rate}:${pitch}:${text}`;
  const cached = ttsAudioCache.get(cacheKey);
  if (cached) {
    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Content-Length', cached.length);
    res.setHeader('Cache-Control', 'public, max-age=86400');
    return res.end(cached);
  }

  try {
    const tts = await getEdgeTtsClient(voice);
    const result = tts.toStream(text, { rate, pitch });

    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Cache-Control', 'public, max-age=86400');

    const chunks: Buffer[] = [];
    result.audioStream.on('data', (chunk: Buffer) => {
      chunks.push(chunk);
      if (!res.writableEnded) {
        res.write(chunk);
      }
    });

    result.audioStream.on('end', () => {
      const fullBuffer = Buffer.concat(chunks);
      if (ttsAudioCache.size >= MAX_CACHE_ENTRIES) {
        const firstKey = ttsAudioCache.keys().next().value;
        if (firstKey) ttsAudioCache.delete(firstKey);
      }
      ttsAudioCache.set(cacheKey, fullBuffer);
      if (!res.writableEnded) {
        res.end();
      }
    });

    result.audioStream.on('error', (err: any) => {
      console.warn('TTS stream error handled:', err?.message || err);
      ttsClients.delete(voice);
      if (!res.headersSent) {
        res.status(500).json({ error: err?.message || 'Streaming failed' });
      } else if (!res.writableEnded) {
        res.end();
      }
    });
  } catch (error: any) {
    console.warn('TTS stream init notice handled:', error?.message || error);
    ttsClients.delete(voice);
    if (!res.headersSent) {
      res.status(500).json({ error: error?.message || 'Streaming failed' });
    }
  }
});

app.post('/api/synthesize', async (req, res) => {
  const { text, voice } = req.body;
  if (!text) {
    return res.status(400).json({ error: 'Text is required' });
  }

  const requestedVoice = voice || 'en-US-JennyNeural';
  const cacheKey = `${requestedVoice}:${text.trim()}`;
  const cached = ttsAudioCache.get(cacheKey);
  if (cached) {
    return res.json({ audioBase64: cached.toString('base64'), visemes: [] });
  }

  try {
    const tts = await getEdgeTtsClient(requestedVoice);
    const result = tts.toStream(text);

    const chunks: Buffer[] = [];
    result.audioStream.on('data', (chunk: Buffer) => chunks.push(chunk));
    result.audioStream.on('end', () => {
      const audioBuffer = Buffer.concat(chunks);
      if (ttsAudioCache.size >= MAX_CACHE_ENTRIES) {
        const firstKey = ttsAudioCache.keys().next().value;
        if (firstKey) ttsAudioCache.delete(firstKey);
      }
      ttsAudioCache.set(cacheKey, audioBuffer);
      const audioBase64 = audioBuffer.toString('base64');
      if (!res.headersSent) {
        res.json({ audioBase64, visemes: [] });
      }
    });
    result.audioStream.on('error', (err: any) => {
      console.error('Edge TTS stream error:', err);
      ttsClients.delete(requestedVoice);
      if (!res.headersSent) {
        res.status(500).json({ error: err.message });
      }
    });
  } catch (error: any) {
    console.error('Edge TTS synthesis error:', error);
    ttsClients.delete(requestedVoice);
    if (!res.headersSent) {
      res.status(500).json({ error: error.message || 'Synthesis failed' });
    }
  }
});

app.post('/api/elevenlabs', async (req, res) => {
  const apiKey = (req.headers['xi-api-key'] as string) || req.body.apiKey || ELEVENLABS_KEY;
  if (!apiKey) {
    return res.status(400).json({ error: 'ElevenLabs API key required. Enter your free API key in the studio panel.' });
  }

  const { text, voiceId, modelId } = req.body;
  if (!text || !voiceId) {
    return res.status(400).json({ error: 'Text and voiceId are required' });
  }

  try {
    const selectedModel = modelId || 'eleven_multilingual_v2';
    const response = await axios.post(
      `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/with-timestamps`,
      {
        text,
        model_id: selectedModel
      },
      {
        headers: {
          'xi-api-key': apiKey,
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        }
      }
    );
    res.json(response.data);
  } catch (error: any) {
    console.error('ElevenLabs synthesis error', error.response?.data || error.message);
    const detail = error.response?.data?.detail;
    const msg = typeof detail === 'string'
      ? detail
      : detail?.message || error.response?.data?.message || 'ElevenLabs synthesis failed';
    res.status(500).json({ error: msg });
  }
});

app.post('/api/save-elevenlabs-key', (req, res) => {
  const { apiKey } = req.body;
  if (apiKey !== undefined) {
    // Strip newlines and escape replacement special chars to prevent .env injection
    const rawKey = apiKey.trim().replace(/[\r\n]/g, '');
    ELEVENLABS_KEY = rawKey;
    const escapedEL = rawKey.replace(/\$/g, '$$$$');
    try {
      const envPath = path.resolve(process.cwd(), '.env');
      let envContent = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';
      if (envContent.includes('ELEVENLABS_API_KEY=')) {
        envContent = envContent.replace(/ELEVENLABS_API_KEY=.*/g, `ELEVENLABS_API_KEY=${escapedEL}`);
      } else {
        envContent += `\nELEVENLABS_API_KEY=${rawKey}\n`;
      }
      fs.writeFileSync(envPath, envContent);
    } catch (e) {
      console.warn('Could not write to .env', e);
    }
  }
  res.json({ success: true, configured: !!ELEVENLABS_KEY });
});

app.get('/api/voices', async (req, res) => {
  const { backend } = req.query;

  if (backend === 'elevenlabs') {
    try {
      const headers: Record<string, string> = {};
      if (ELEVENLABS_KEY) headers['xi-api-key'] = ELEVENLABS_KEY;

      const response = await axios.get('https://api.elevenlabs.io/v1/voices', { headers });
      const mapped = (response.data.voices || []).map((v: any) => ({
        id: v.voice_id,
        name: `${v.name} (ElevenLabs)`,
        lang: v.labels?.accent ? `en-${v.labels.accent.toUpperCase()}` : 'en-US',
        backend: 'elevenlabs',
        previewUrl: v.preview_url,
        description: v.description || v.labels?.descriptive || 'ElevenLabs Neural Voice'
      }));
      res.json(mapped);
    } catch (error: any) {
      console.warn('Notice fetching elevenlabs voices (using local voice pack):', error.response?.data?.detail?.message || error.message);
      res.json([]);
    }
  } else {
    res.json([]);
  }
});

app.use('/api/agent', createAgentRouter());

app.listen(PORT, () => {
  console.log(`TTS proxy server running on http://localhost:${PORT}`);
});
