/**
 * Admin Routes — Protected API endpoints for admin-only access.
 * 
 * All routes require the X-Admin-Token / Authorization header or X-Admin-Secret header
 * matching the ADMIN_SECRET environment variable.
 * 
 * Normal users have NO visibility into these endpoints.
 */

import { Router, Request, Response, NextFunction } from 'express';
import fs from 'fs';
import path from 'path';
import { AgentCore } from '../agent/AgentCore';
import { isSupabaseConfigured, getSupabaseCredentials, testSupabaseConnection, updateSupabaseCredentials } from '../db/supabaseClient';
import { persistEnvVar } from '../utils/envUtils';
import { timingSafeCompare, createAdminToken, verifyAdminToken } from '../utils/authUtils';
import { sanitizeString } from '../utils/sanitizer';

/**
 * Dynamically resolves the current admin secret from .env so password updates
 * take effect immediately without requiring a manual server restart.
 */
export function getLiveAdminSecret(): string | undefined {
  try {
    const envPath = path.resolve(process.cwd(), '.env');
    if (fs.existsSync(envPath)) {
      const content = fs.readFileSync(envPath, 'utf-8');
      const match = content.match(/^ADMIN_SECRET\s*=\s*(.*)$/m);
      if (match && match[1]) {
        let val = match[1].trim();
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
          val = val.slice(1, -1);
        }
        const commentIdx = val.indexOf('#');
        if (commentIdx !== -1) val = val.slice(0, commentIdx).trim();
        if (val) return val;
      }
    }
  } catch {}
  return process.env.ADMIN_SECRET?.trim();
}

// In-memory usage analytics (resets on server restart)
const analytics = {
  totalRequests: 0,
  providerUsage: {} as Record<string, number>,
  intentUsage: {} as Record<string, number>,
  avgResponseTimeMs: 0,
  responseTimes: [] as number[],
  sessionStart: Date.now(),
  errors: 0
};

export function trackRequest(provider: string, intent?: string, responseTimeMs?: number) {
  analytics.totalRequests++;
  analytics.providerUsage[provider] = (analytics.providerUsage[provider] || 0) + 1;
  if (intent) {
    analytics.intentUsage[intent] = (analytics.intentUsage[intent] || 0) + 1;
  }
  if (responseTimeMs) {
    analytics.responseTimes.push(responseTimeMs);
    if (analytics.responseTimes.length > 1000) analytics.responseTimes.shift();
    analytics.avgResponseTimeMs = Math.round(
      analytics.responseTimes.reduce((a, b) => a + b, 0) / analytics.responseTimes.length
    );
  }
}

export function trackError() {
  analytics.errors++;
}

// ── Auth Middleware ───────────────────────────────────────────────────────────

export function adminAuthMiddleware(req: Request, res: Response, next: NextFunction) {
  const secret = getLiveAdminSecret();
  if (!secret) {
    return res.status(403).json({ error: 'Admin access is not configured on this server.' });
  }

  // 1. Check Bearer token or x-admin-token
  const authHeader = req.headers['authorization'];
  const tokenFromBearer = authHeader?.startsWith('Bearer ') ? authHeader.slice(7).trim() : null;
  const tokenFromHeader = (req.headers['x-admin-token'] as string)?.trim();
  const token = tokenFromBearer || tokenFromHeader;

  if (token && verifyAdminToken(token)) {
    return next();
  }

  // 2. Direct x-admin-secret header check (timing-safe)
  const providedSecret = (req.headers['x-admin-secret'] as string)?.trim();
  if (providedSecret && timingSafeCompare(providedSecret, secret)) {
    return next();
  }

  // Unauthorized: Return generic 401
  return res.status(401).json({ error: 'Unauthorized: Valid admin token or secret required.' });
}

// ── Router Factory ────────────────────────────────────────────────────────────

export function createAdminRouter(agentCore: AgentCore): Router {
  const router = Router();

  // ── Public Admin Login Route (Rate-limited at app level) ────────────────────
  router.post('/login', (req, res) => {
    const { password } = req.body || {};
    const secret = getLiveAdminSecret();

    if (!secret) {
      return res.status(500).json({ error: 'ADMIN_SECRET is not configured on the server.' });
    }

    if (!password || typeof password !== 'string') {
      return res.status(400).json({ error: 'Password is required.' });
    }

    if (!timingSafeCompare(password.trim(), secret)) {
      return res.status(401).json({ error: 'Invalid admin credentials.' });
    }

    // Issue cryptographically signed token valid for 8 hours
    const token = createAdminToken(8);
    res.json({
      success: true,
      token,
      message: 'Authenticated successfully'
    });
  });

  // Verify active token
  router.get('/verify', adminAuthMiddleware, (req, res) => {
    res.json({ valid: true, authenticated: true });
  });

  // Apply auth to all subsequent admin routes
  router.use(adminAuthMiddleware);

  // ── GET /api/admin/dashboard ── Full system status
  router.get('/dashboard', async (req, res) => {
    try {
      const providerHealth = await agentCore.getProviderManager().getHealth();
      const tools = agentCore.getToolRegistry().getAllDefinitions();
      const memory = agentCore.getMemoryStore();
      const supaConfigured = isSupabaseConfigured();
      const supaCredentials = getSupabaseCredentials();

      const keyStatus = {
        gemini: !!(process.env.GEMINI_API_KEY?.trim()),
        grok: !!(process.env.GROK_API_KEY?.trim() || process.env.XAI_API_KEY?.trim()),
        elevenlabs: !!(process.env.ELEVENLABS_API_KEY?.trim()),
        anthropic: !!(process.env.ANTHROPIC_API_KEY?.trim()),
        openai: !!(process.env.OPENAI_API_KEY?.trim()),
        tavily: !!(process.env.TAVILY_API_KEY?.trim())
      };

      res.json({
        system: {
          status: 'healthy',
          uptime: Date.now() - analytics.sessionStart,
          nodeVersion: process.version,
          platform: process.platform,
          nodeEnv: process.env.NODE_ENV || 'production'
        },
        providers: {
          active: providerHealth.activeProvider,
          modelInfo: providerHealth.modelInfo,
          available: providerHealth.availableProviders
        },
        keyStatus,
        tools: {
          registered: tools.length,
          list: tools.map(t => ({ name: t.name, permission: t.permission, description: t.description }))
        },
        memory: {
          items: memory.getAllMemories().length,
          tasks: memory.listTasks().length,
          notes: memory.listNotes().length
        },
        database: {
          supabase: {
            configured: supaConfigured,
            url: supaCredentials.url ? supaCredentials.url.replace(/^(https?:\/\/[^.]+).*/, '$1.supabase.co') : null
          }
        },
        analytics,
        langgraph: {
          orchestratorVersion: '2.0',
          nodes: ['classify', 'routeModel', 'think', 'toolCall', 'synthesize', 'reflect'],
          description: 'Multi-node graph with intent classification, model routing, chain-of-thought reasoning, tool execution, synthesis, and quality reflection'
        }
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── GET /api/admin/analytics ── Usage statistics
  router.get('/analytics', (req, res) => {
    const uptimeMs = Date.now() - analytics.sessionStart;
    const uptimeMins = Math.floor(uptimeMs / 60000);

    res.json({
      ...analytics,
      uptimeMinutes: uptimeMins,
      requestsPerMinute: uptimeMins > 0 ? (analytics.totalRequests / uptimeMins).toFixed(2) : analytics.totalRequests,
      errorRate: analytics.totalRequests > 0
        ? ((analytics.errors / analytics.totalRequests) * 100).toFixed(1) + '%'
        : '0%'
    });
  });

  // ── POST /api/admin/reset-analytics ── Clear analytics
  router.post('/reset-analytics', (req, res) => {
    analytics.totalRequests = 0;
    analytics.providerUsage = {};
    analytics.intentUsage = {};
    analytics.avgResponseTimeMs = 0;
    analytics.responseTimes = [];
    analytics.errors = 0;
    analytics.sessionStart = Date.now();
    res.json({ success: true, message: 'Analytics reset' });
  });

  // ── GET /api/admin/keys ── View configured API keys (masked)
  router.get('/keys', (req, res) => {
    const mask = (key?: string) => {
      if (!key?.trim()) return null;
      return key.substring(0, 8) + '...' + key.slice(-4);
    };

    res.json({
      gemini: { configured: !!process.env.GEMINI_API_KEY?.trim(), masked: mask(process.env.GEMINI_API_KEY) },
      grok: { configured: !!(process.env.GROK_API_KEY?.trim() || process.env.XAI_API_KEY?.trim()), masked: mask(process.env.GROK_API_KEY || process.env.XAI_API_KEY) },
      elevenlabs: { configured: !!process.env.ELEVENLABS_API_KEY?.trim(), masked: mask(process.env.ELEVENLABS_API_KEY) },
      anthropic: { configured: !!process.env.ANTHROPIC_API_KEY?.trim(), masked: mask(process.env.ANTHROPIC_API_KEY) },
      openai: { configured: !!process.env.OPENAI_API_KEY?.trim(), masked: mask(process.env.OPENAI_API_KEY) },
      tavily: { configured: !!process.env.TAVILY_API_KEY?.trim(), masked: mask(process.env.TAVILY_API_KEY) },
      adminSecret: { configured: true, masked: mask(process.env.ADMIN_SECRET) }
    });
  });

  // ── POST /api/admin/keys ── Update API keys
  router.post('/keys', (req, res) => {
    const { provider, apiKey } = req.body;
    if (!provider || typeof apiKey !== 'string') {
      return res.status(400).json({ error: 'provider and apiKey required' });
    }

    const keyMap: Record<string, string> = {
      gemini: 'GEMINI_API_KEY',
      grok: 'GROK_API_KEY',
      xai: 'XAI_API_KEY',
      elevenlabs: 'ELEVENLABS_API_KEY',
      anthropic: 'ANTHROPIC_API_KEY',
      openai: 'OPENAI_API_KEY',
      tavily: 'TAVILY_API_KEY',
      admin: 'ADMIN_SECRET'
    };

    const cleanProvider = sanitizeString(provider, 32).toLowerCase();
    const envVar = keyMap[cleanProvider];
    if (!envVar) return res.status(400).json({ error: `Unknown provider: ${cleanProvider}` });

    const safeKey = sanitizeString(apiKey, 512).replace(/[\r\n]/g, '');
    process.env[envVar] = safeKey;
    if (cleanProvider === 'grok') process.env.XAI_API_KEY = safeKey;

    agentCore.getProviderManager().setProviderKey(cleanProvider, safeKey);

    try {
      persistEnvVar(envVar, safeKey);
      if (cleanProvider === 'grok') persistEnvVar('XAI_API_KEY', safeKey);
    } catch (e: any) {
      console.warn('Could not persist key:', e.message);
    }

    res.json({ success: true, provider: cleanProvider, configured: !!safeKey });
  });

  // ── GET /api/admin/supabase ── Supabase status
  router.get('/supabase', async (req, res) => {
    try {
      const configured = isSupabaseConfigured();
      const credentials = getSupabaseCredentials();
      const connection = configured ? await testSupabaseConnection() : { connected: false, error: 'Not configured' };

      res.json({
        configured,
        url: credentials.url ? credentials.url.replace(/^(https?:\/\/[^.]+).*/, '$1.supabase.co') : null,
        connection
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── POST /api/admin/supabase ── Configure Supabase (Server-side only)
  router.post('/supabase', async (req, res) => {
    const { url, key } = req.body;
    if (!url || !key) return res.status(400).json({ error: 'url and key required' });

    const cleanUrl = sanitizeString(url, 256);
    const cleanKey = sanitizeString(key, 512);

    try {
      updateSupabaseCredentials(cleanUrl, cleanKey);
      persistEnvVar('SUPABASE_URL', cleanUrl);
      persistEnvVar('SUPABASE_ANON_KEY', cleanKey);
      const connection = await testSupabaseConnection();
      res.json({ success: true, connection });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── GET /api/admin/memory ── View all memory
  router.get('/memory', (req, res) => {
    const memory = agentCore.getMemoryStore();
    res.json({
      memories: memory.getAllMemories(),
      tasks: memory.listTasks(),
      notes: memory.listNotes(),
      preferences: memory.getPreferences(),
      history: agentCore.getConversationHistory()
    });
  });

  // ── DELETE /api/admin/memory ── Clear all memory
  router.delete('/memory', (req, res) => {
    agentCore.clearContext();
    res.json({ success: true, message: 'All memory and history cleared' });
  });

  // ── GET /api/admin/tools ── List all tools with full details
  router.get('/tools', (req, res) => {
    const tools = agentCore.getToolRegistry().getAllDefinitions();
    res.json({ total: tools.length, tools });
  });

  // ── GET /api/admin/providers ── Full provider health
  router.get('/providers', async (req, res) => {
    try {
      const health = await agentCore.getProviderManager().getHealth();
      res.json(health);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── POST /api/admin/test-provider ── Test a specific provider
  router.post('/test-provider', async (req, res) => {
    const { provider, testMessage } = req.body;
    const cleanProvider = sanitizeString(provider, 32);
    const cleanMsg = sanitizeString(testMessage, 500) || 'Hello, are you working correctly?';

    try {
      const start = Date.now();
      const response = await agentCore.handleUserMessage(cleanMsg, {
        modelProvider: cleanProvider || 'gemini',
        mode: 'chat',
        maxTokens: 256
      });
      const elapsed = Date.now() - start;

      res.json({
        success: true,
        provider: cleanProvider || 'auto',
        modelUsed: response.modelUsed,
        response: response.response.substring(0, 200),
        latencyMs: elapsed
      });
    } catch (err: any) {
      res.json({ success: false, error: err.message });
    }
  });

  return router;
}
