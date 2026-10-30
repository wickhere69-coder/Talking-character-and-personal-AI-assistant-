import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import axios from 'axios';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { EdgeTTS } from 'node-edge-tts';
import { createAgentRouter } from './agent/routes';
import { createAdminRouter } from './routes/adminRoutes';
import { persistEnvVar } from './utils/envUtils';
import { AgentCore } from './agent/AgentCore';
import { sanitizeString } from './utils/sanitizer';
import { adminAuthMiddleware } from './routes/adminRoutes';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;
let ELEVENLABS_KEY = process.env.ELEVENLABS_API_KEY || '';

// ── 1. Security Headers (Helmet) ─────────────────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "'wasm-unsafe-eval'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com", "data:"],
      imgSrc: ["'self'", "data:", "blob:", "https:"],
      connectSrc: [
        "'self'",
        "http://localhost:*",
        "http://127.0.0.1:*",
        "https://generativelanguage.googleapis.com",
        "https://api.elevenlabs.io",
        "https://*.supabase.co"
      ],
      mediaSrc: ["'self'", "blob:", "data:"],
      workerSrc: ["'self'", "blob:"],
      objectSrc: ["'none'"],
      frameAncestors: ["'self'"]
    }
  },
  crossOriginEmbedderPolicy: false,
  crossOriginResourcePolicy: { policy: "cross-origin" },
  hidePoweredBy: true,
  noSniff: true,
  xssFilter: true,
  frameguard: { action: 'sameorigin' }
}));

// ── 2. CORS Hardening ────────────────────────────────────────────────────────
const allowedOrigins = (process.env.ALLOWED_ORIGINS || 'http://localhost:5173,http://127.0.0.1:5173,http://localhost:3000')
  .split(',')
  .map(o => o.trim());

app.use(cors({
  origin: (origin, callback) => {
    // Allow non-browser requests (e.g. server-to-server, curl)
    if (!origin) return callback(null, true);
    if (
      allowedOrigins.includes(origin) ||
      origin.startsWith('http://localhost:') ||
      origin.startsWith('http://127.0.0.1:')
    ) {
      return callback(null, true);
    }
    return callback(new Error(`CORS violation: Origin "${origin}" is not authorized.`));
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-admin-secret', 'x-admin-token'],
  credentials: true,
  maxAge: 86400
}));

// ── 3. Request Size Sanitization & Protection ────────────────────────────────
app.use(express.json({ limit: '512kb' }));

// ── 4. Rate Limiting ─────────────────────────────────────────────────────────
// Global limiter: 180 requests per minute
const globalLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 180,
  message: { error: 'Too many requests from this IP address, please try again in a minute.' },
  standardHeaders: true,
  legacyHeaders: false
});
app.use(globalLimiter);

// AI Chat rate limiter: 40 requests per minute (prevents quota exhaustion & billing spikes)
const aiChatLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 40,
  message: { error: 'AI generation rate limit exceeded. Please wait a moment before sending another message.' },
  standardHeaders: true,
  legacyHeaders: false
});
app.use('/api/agent/chat', aiChatLimiter);
app.use('/api/agent/stream', aiChatLimiter);

// Audio synthesis rate limiter: 60 requests per minute
const ttsLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  message: { error: 'Audio synthesis rate limit reached. Please wait a moment.' },
  standardHeaders: true,
  legacyHeaders: false
});
app.use('/api/synthesize', ttsLimiter);
app.use('/api/tts-stream', ttsLimiter);
app.use('/api/elevenlabs', ttsLimiter);

// Admin Auth brute-force limiter: 20 attempts per 5 minutes (ignoring successful logins)
const adminLoginLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 20,
  skipSuccessfulRequests: true,
  message: { error: 'Too many failed admin authentication attempts. Access temporarily locked for 5 minutes.' },
  standardHeaders: true,
  legacyHeaders: false
});
app.use('/api/admin/login', adminLoginLimiter);

// ── 5. Process-level Safeguards ──────────────────────────────────────────────
process.on('uncaughtException', (err: any) => {
  console.warn('[SERVER UNCAUGHT EXCEPTION SAFEGUARD]:', err?.message || err);
});
process.on('unhandledRejection', (reason: any) => {
  console.warn('[SERVER UNHANDLED REJECTION SAFEGUARD]:', reason);
});

// ── Status Route ─────────────────────────────────────────────────────────────
app.get('/api/status', (req, res) => {
  res.json({
    azure: true,
    elevenlabs: !!ELEVENLABS_KEY
  });
});

const ttsAudioCache = new Map<string, Buffer>();
const edgeTtsInstances = new Map<string, EdgeTTS>();
function getEdgeTTS(voice: string): EdgeTTS {
  let instance = edgeTtsInstances.get(voice);
  if (!instance) {
    instance = new EdgeTTS({
      voice,
      outputFormat: 'audio-24khz-48kbitrate-mono-mp3'
    });
    edgeTtsInstances.set(voice, instance);
  }
  return instance;
}
const MAX_CACHE_ENTRIES = 120;

// Voice map strictly mapping ElevenLabs voice IDs to Microsoft Neural voices
const VOICE_MAP: Record<string, string> = {
  'pFZP5JQG7iQjIQuC4Bku': 'en-GB-SoniaNeural',   // Lily (Velvety, Warm British Narrator)
  'Xb7hH8MSUJpSbSDYk0k2': 'en-GB-LibbyNeural',   // Alice (Clear, Engaging British Educator)
  'hpp4J3VqNfWAUOO0d1Us': 'en-US-JennyNeural',   // Bella (Warm, Professional US English)
  'cgSgspJ2msm6clMCkdW9': 'en-US-AriaNeural',    // Jessica (Playful, Bright, Warm US English)
  'XrExE9yKIg1WjnnlVkGX': 'en-US-SaraNeural',    // Matilda (Warm, Professional)
  'EXAVITQu4vr4xnSDxMaL': 'en-US-MichelleNeural' // Sarah
};

async function synthesizeNeuralAudio(text: string, voiceId?: string): Promise<Buffer | null> {
  const clean = sanitizeString(text, 1000)
    .replace(/[*#`_~\[\]]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (!clean) return null;

  const voiceName = (voiceId && VOICE_MAP[voiceId]) || 'en-GB-SoniaNeural';

  // 1. Primary: Microsoft Edge Neural TTS
  try {
    const tts = getEdgeTTS(voiceName);
    const chunks: Buffer[] = [];
    for await (const chunk of tts.streamAudio(clean)) {
      if (Buffer.isBuffer(chunk)) {
        chunks.push(chunk);
      }
    }
    if (chunks.length > 0) {
      return Buffer.concat(chunks);
    }
  } catch (err: any) {
    console.warn(`[EDGE TTS] Synthesis notice:`, err?.message || err);
  }

  // 2. Secondary Fallback: Google TTS API
  try {
    const googleTTS = await import('google-tts-api');
    const results = await (googleTTS as any).getAllAudioBase64(clean, {
      lang: 'en',
      slow: false,
      timeout: 10000
    });
    const bufs = results.map((r: any) => Buffer.from(r.base64, 'base64'));
    if (bufs.length > 0) {
      return Buffer.concat(bufs);
    }
  } catch (err: any) {
    console.warn('[GOOGLE TTS FALLBACK] error:', err?.message || err);
  }

  return null;
}

app.get('/api/tts-stream', async (req, res) => {
  const rawText = sanitizeString(req.query.text as string || '', 1000);
  const rawVoice = sanitizeString(req.query.voice as string || '', 64) || 'pFZP5JQG7iQjIQuC4Bku';
  if (!rawText) {
    return res.status(400).send('Text is required');
  }

  const cacheKey = `${rawVoice}:${rawText}`;
  const cached = ttsAudioCache.get(cacheKey);
  if (cached) {
    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Content-Length', cached.length);
    res.setHeader('Cache-Control', 'public, max-age=86400');
    return res.end(cached);
  }

  const clean = rawText
    .replace(/[*#`_~\[\]]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (!clean) {
    return res.status(400).send('Empty text after cleaning');
  }

  const voiceName = (rawVoice && VOICE_MAP[rawVoice]) || 'en-GB-SoniaNeural';

  try {
    const tts = new EdgeTTS({
      voice: voiceName,
      outputFormat: 'audio-24khz-48kbitrate-mono-mp3'
    });

    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Transfer-Encoding', 'chunked');
    res.setHeader('Cache-Control', 'public, max-age=86400');

    const chunks: Buffer[] = [];
    let clientDisconnected = false;
    req.on('close', () => {
      clientDisconnected = true;
    });

    for await (const chunk of tts.streamAudio(clean)) {
      if (Buffer.isBuffer(chunk)) {
        chunks.push(chunk);
        if (!clientDisconnected && !res.writableEnded) {
          res.write(chunk);
        }
      }
    }

    if (!res.writableEnded) {
      res.end();
    }

    if (chunks.length > 0) {
      const audioBuf = Buffer.concat(chunks);
      if (ttsAudioCache.size >= MAX_CACHE_ENTRIES) {
        const firstKey = ttsAudioCache.keys().next().value;
        if (firstKey) ttsAudioCache.delete(firstKey);
      }
      ttsAudioCache.set(cacheKey, audioBuf);
    }
  } catch (error: any) {
    console.warn('Edge TTS streaming notice, attempting fallback:', error.message);
    if (!res.headersSent) {
      try {
        const audioBuf = await synthesizeNeuralAudio(clean, rawVoice);
        if (audioBuf) {
          res.setHeader('Content-Type', 'audio/mpeg');
          res.setHeader('Content-Length', audioBuf.length);
          return res.end(audioBuf);
        }
      } catch (fbErr: any) {
        res.status(500).json({ error: fbErr.message || 'Streaming failed' });
      }
    }
  }
});

app.post('/api/synthesize', async (req, res) => {
  const rawText = sanitizeString(req.body.text, 1000);
  const voice = sanitizeString(req.body.voice, 64);
  if (!rawText) {
    return res.status(400).json({ error: 'Text is required' });
  }

  const requestedVoice = voice || 'pFZP5JQG7iQjIQuC4Bku';
  const cacheKey = `${requestedVoice}:${rawText}`;
  const cached = ttsAudioCache.get(cacheKey);
  if (cached) {
    return res.json({ audioBase64: cached.toString('base64'), visemes: [] });
  }

  try {
    const audioBuf = await synthesizeNeuralAudio(rawText, requestedVoice);
    if (audioBuf) {
      if (ttsAudioCache.size >= MAX_CACHE_ENTRIES) {
        const firstKey = ttsAudioCache.keys().next().value;
        if (firstKey) ttsAudioCache.delete(firstKey);
      }
      ttsAudioCache.set(cacheKey, audioBuf);
      return res.json({ audioBase64: audioBuf.toString('base64'), visemes: [] });
    }
    throw new Error('Synthesis failed');
  } catch (error: any) {
    console.warn('Neural synthesis notice:', error.message);
    if (!res.headersSent) {
      res.status(500).json({ error: error.message || 'Synthesis failed' });
    }
  }
});

app.post('/api/elevenlabs', async (req, res) => {
  const apiKey = (req.headers['xi-api-key'] as string) || req.body.apiKey || ELEVENLABS_KEY;
  if (!apiKey) {
    return res.status(400).json({ error: 'ElevenLabs API key required. Configure your secret API key in the Admin Panel.' });
  }

  const cleanKey = sanitizeString(apiKey, 256);
  if (!cleanKey.startsWith('sk_')) {
    return res.status(400).json({
      error: 'Invalid ElevenLabs API key: Key must begin with "sk_".'
    });
  }

  const text = sanitizeString(req.body.text, 1500);
  const voiceId = sanitizeString(req.body.voiceId, 64);
  const modelId = sanitizeString(req.body.modelId, 64);

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
          'xi-api-key': cleanKey,
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        timeout: 20000
      }
    );
    res.json(response.data);
  } catch (error: any) {
    const detail = error.response?.data?.detail;
    const msg = typeof detail === 'string'
      ? detail
      : detail?.message || error.response?.data?.message || 'ElevenLabs synthesis failed';
    res.status(500).json({ error: msg });
  }
});

// Admin-protected key management for ElevenLabs
app.post('/api/save-elevenlabs-key', adminAuthMiddleware, (req, res) => {
  const { apiKey } = req.body;
  if (apiKey !== undefined && typeof apiKey === 'string') {
    const rawKey = sanitizeString(apiKey, 256).replace(/[\r\n]/g, '');
    ELEVENLABS_KEY = rawKey;
    try {
      persistEnvVar('ELEVENLABS_API_KEY', rawKey);
    } catch (e: any) {
      console.warn('Could not write to .env', e.message);
    }
  }
  res.json({ success: true, configured: !!ELEVENLABS_KEY });
});

app.get('/api/voices', async (req, res) => {
  const backend = sanitizeString(req.query.backend, 32);

  if (backend === 'elevenlabs') {
    try {
      const headers: Record<string, string> = {};
      if (ELEVENLABS_KEY) headers['xi-api-key'] = ELEVENLABS_KEY;

      const response = await axios.get('https://api.elevenlabs.io/v1/voices', { headers, timeout: 8000 });
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

// Shared AgentCore instance (used by both agent and admin routers)
const sharedAgentCore = new AgentCore();
app.use('/api/agent', createAgentRouter(sharedAgentCore));

// Admin panel — protected by admin authentication token, invisible to normal users
app.use('/api/admin', createAdminRouter(sharedAgentCore));

// ── 6. Safe 404 & Global Error Handling (Zero Stack Leaks in Production) ──────
app.use((req, res) => {
  res.status(404).json({ error: 'Endpoint not found.' });
});

app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.warn('[SERVER ERROR CAUGHT]:', err.message);
  if (res.headersSent) return next(err);
  const isDev = process.env.NODE_ENV === 'development';
  res.status(err.status || 500).json({
    error: isDev ? err.message : 'An unexpected server error occurred.',
    status: 'error'
  });
});

app.listen(PORT, () => {
  console.log(`TTS proxy server running securely on http://localhost:${PORT} [NODE_ENV=${process.env.NODE_ENV || 'production'}]`);
});
