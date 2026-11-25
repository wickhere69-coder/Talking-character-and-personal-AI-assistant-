import { Router } from 'express';
import { sanitizeString, isValidIdentifier, isSafeHttpUrl, sanitizeErrorMessage } from '../utils/sanitizer';
import { adminAuthMiddleware } from '../routes/adminRoutes';
import { AgentCore } from './AgentCore';
import { persistEnvVar } from '../utils/envUtils';
import { 
  testSupabaseConnection, 
  updateSupabaseCredentials, 
  isSupabaseConfigured, 
  getSupabaseCredentials 
} from '../db/supabaseClient';

export function createAgentRouter(sharedAgent?: AgentCore): Router {
  const router = Router();
  const agent = sharedAgent || new AgentCore();

  // 1. Main Chat Endpoint (Supports optional sessionId for persistent, isolated session memory)
  router.post('/chat', async (req, res) => {
    const { message, config, sessionId } = req.body;
    if (!message || typeof message !== 'string') {
      return res.status(400).json({ error: 'Field "message" is required and must be a string.' });
    }
    if (sessionId !== undefined && sessionId !== null && !isValidIdentifier(sessionId)) {
      return res.status(400).json({ error: 'Invalid sessionId format.' });
    }
    const safeMessage = sanitizeString(message, 4000);
    const safeSessionId = sessionId ? sanitizeString(sessionId, 128) : undefined;

    try {
      const response = await agent.handleUserMessage(safeMessage, config || {}, safeSessionId);
      res.json(response);
    } catch (err: any) {
      console.error('Agent chat error:', sanitizeErrorMessage(err));
      const safeErr = sanitizeErrorMessage(err);
      res.status(500).json({
        response: `I ran into an unexpected error: ${safeErr}`,
        status: 'error',
        error: safeErr,
        modelUsed: 'error_handler'
      });
    }
  });

  // 1b. Real-time Streaming Endpoint (SSE for Conversational Mode)
  router.post('/stream', async (req, res) => {
    const { message, config, sessionId } = req.body;
    if (!message || typeof message !== 'string') {
      return res.status(400).json({ error: 'Field "message" is required and must be a string.' });
    }
    if (sessionId !== undefined && sessionId !== null && !isValidIdentifier(sessionId)) {
      return res.status(400).json({ error: 'Invalid sessionId format.' });
    }
    const safeStreamMsg = sanitizeString(message, 4000);
    const safeStreamSessionId = sessionId ? sanitizeString(sessionId, 128) : undefined;

    // Set SSE headers
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();

    const abortController = new AbortController();
    res.on('close', () => {
      if (!res.writableEnded) {
        abortController.abort();
      }
    });

    try {
      const result = await agent.handleUserMessageStream(
        safeStreamMsg,
        config || {},
        (chunk: string) => {
          if (!res.writableEnded) {
            res.write(`data: ${JSON.stringify({ chunk })}\n\n`);
          }
        },
        abortController.signal,
        safeStreamSessionId
      );

      if (!res.writableEnded) {
        res.write(`data: ${JSON.stringify({ done: true, fullResponse: result.response, modelUsed: result.modelUsed, sessionId: result.sessionId })}\n\n`);
        res.end();
      }
    } catch (err: any) {
      console.error('Agent stream error:', sanitizeErrorMessage(err));
      if (!res.writableEnded) {
        res.write(`data: ${JSON.stringify({ error: sanitizeErrorMessage(err, 'Stream processing failed') })}\n\n`);
        res.end();
      }
    }
  });

  // ── Session Management Endpoints ────────────────────────────────────────

  // List sessions (supports ?includeArchived=true&search=...)
  router.get('/sessions', (req, res) => {
    try {
      const includeArchived = req.query.includeArchived === 'true';
      const search = typeof req.query.search === 'string' ? sanitizeString(req.query.search, 128) : undefined;
      const sessions = agent.getSessionManager().listSessions({ includeArchived, search });
      res.json({ sessions });
    } catch (err: any) {
      res.status(500).json({ error: sanitizeErrorMessage(err) });
    }
  });

  // Create new session
  router.post('/sessions', (req, res) => {
    try {
      const { title, topic } = req.body || {};
      const safeTitle = title ? sanitizeString(title, 120) : undefined;
      const safeTopic = topic ? sanitizeString(topic, 120) : undefined;
      const session = agent.getSessionManager().createSession(safeTitle, safeTopic);
      res.status(201).json({ session });
    } catch (err: any) {
      res.status(500).json({ error: sanitizeErrorMessage(err) });
    }
  });

  // Search sessions & messages
  router.get('/sessions/search', (req, res) => {
    try {
      const query = sanitizeString(String(req.query.q || ''), 128);
      const results = agent.getSessionManager().search(query);
      res.json({ results });
    } catch (err: any) {
      res.status(500).json({ error: sanitizeErrorMessage(err) });
    }
  });

  // Get specific session + messages
  router.get('/sessions/:id', (req, res) => {
    if (!isValidIdentifier(req.params.id)) {
      return res.status(400).json({ error: 'Invalid session ID.' });
    }
    try {
      const data = agent.getSessionManager().getSession(req.params.id);
      if (!data) {
        return res.status(404).json({ error: 'Session not found.' });
      }
      res.json(data);
    } catch (err: any) {
      res.status(500).json({ error: sanitizeErrorMessage(err) });
    }
  });

  // Update session (title, topic, pinned, archived)
  router.patch('/sessions/:id', (req, res) => {
    if (!isValidIdentifier(req.params.id)) {
      return res.status(400).json({ error: 'Invalid session ID.' });
    }
    try {
      const updated = agent.getSessionManager().updateSession(req.params.id, req.body || {});
      if (!updated) {
        return res.status(404).json({ error: 'Session not found.' });
      }
      res.json({ session: updated });
    } catch (err: any) {
      res.status(500).json({ error: sanitizeErrorMessage(err) });
    }
  });

  // Delete session + messages
  router.delete('/sessions/:id', (req, res) => {
    if (!isValidIdentifier(req.params.id)) {
      return res.status(400).json({ error: 'Invalid session ID.' });
    }
    try {
      const deleted = agent.getSessionManager().deleteSession(req.params.id);
      if (!deleted) {
        return res.status(404).json({ error: 'Session not found.' });
      }
      res.json({ success: true, id: req.params.id });
    } catch (err: any) {
      res.status(500).json({ error: sanitizeErrorMessage(err) });
    }
  });

  // Get session messages
  router.get('/sessions/:id/messages', (req, res) => {
    if (!isValidIdentifier(req.params.id)) {
      return res.status(400).json({ error: 'Invalid session ID.' });
    }
    try {
      const parsedLimit = req.query.limit ? Math.min(Math.max(1, Number(req.query.limit) || 50), 500) : undefined;
      const messages = agent.getSessionManager().getMessages(req.params.id, parsedLimit);
      res.json({ messages });
    } catch (err: any) {
      res.status(500).json({ error: sanitizeErrorMessage(err) });
    }
  });

  // Add message to session
  router.post('/sessions/:id/messages', (req, res) => {
    if (!isValidIdentifier(req.params.id)) {
      return res.status(400).json({ error: 'Invalid session ID.' });
    }
    try {
      const { role, content, extra } = req.body || {};
      if (!role || typeof content !== 'string' || !content.trim()) {
        return res.status(400).json({ error: 'role and content are required.' });
      }
      if (!['user', 'assistant', 'system'].includes(role)) {
        return res.status(400).json({ error: 'Invalid message role.' });
      }
      const message = agent.getSessionManager().addMessage(req.params.id, role, sanitizeString(content, 16000), extra || {});
      res.status(201).json({ message });
    } catch (err: any) {
      res.status(500).json({ error: sanitizeErrorMessage(err) });
    }
  });

  // Trigger manual / forced summarization of session
  router.post('/sessions/:id/summarize', async (req, res) => {
    if (!isValidIdentifier(req.params.id)) {
      return res.status(400).json({ error: 'Invalid session ID.' });
    }
    try {
      await agent.triggerBackgroundSummarization(req.params.id);
      const data = agent.getSessionManager().getSession(req.params.id);
      res.json({ success: true, session: data?.session });
    } catch (err: any) {
      res.status(500).json({ error: sanitizeErrorMessage(err) });
    }
  });

  // 2. Confirmation Resolution
  router.post('/confirm', async (req, res) => {
    const { confirmationId, approved } = req.body;
    if (!confirmationId || typeof approved !== 'boolean') {
      return res.status(400).json({ error: 'confirmationId and approved (boolean) are required.' });
    }

    try {
      const response = await agent.resolveConfirmation(sanitizeString(confirmationId, 128), approved);
      res.json(response);
    } catch (err: any) {
      res.status(500).json({ error: sanitizeErrorMessage(err) });
    }
  });

  // 3. Health & Diagnostics
  router.get('/health', async (req, res) => {
    const providerManager = agent.getProviderManager();
    const health = await providerManager.getHealth();
    const tools = agent.getToolRegistry().getAllDefinitions();

    res.json({
      status: 'ok',
      connected: true,
      model: health.activeProvider,
      availableProviders: health.availableProviders,
      toolsCount: tools.length,
      tools: tools.map((t: any) => ({ name: t.name, description: t.description })),
      sessionCount: agent.getSessionManager().listSessions({ includeArchived: true }).length
    });
  });

  // 4. Memory Items (Key-Value)
  router.get('/memory', (req, res) => {
    const category = req.query.category as string | undefined;
    res.json({
      memories: agent.getMemoryStore().list(category)
    });
  });

  router.post('/memory', (req, res) => {
    const { key, value, category } = req.body;
    if (!key || typeof key !== 'string' || key.length > 128 || /[\0\r\n]/.test(key) || typeof value !== 'string' || !value.trim()) {
      return res.status(400).json({ error: 'Valid key and value are required.' });
    }
    const safeCategory = category ? sanitizeString(category, 64) : undefined;
    const memory = agent.getMemoryStore().set(key.trim(), sanitizeString(value, 8000), safeCategory);
    res.json(memory);
  });

  router.delete('/memory/:key', (req, res) => {
    const key = req.params.key || '';
    if (!key || key.length > 128 || /[\0\r\n]/.test(key)) {
      return res.status(400).json({ error: 'Invalid memory key.' });
    }
    const deleted = agent.getMemoryStore().delete(key);
    res.json({ success: deleted });
  });

  // 5. Tasks
  router.get('/tasks', (req, res) => {
    const status = req.query.status as any;
    res.json({
      tasks: agent.getMemoryStore().listTasks(status)
    });
  });

  // 6. Notes
  router.get('/notes', (req, res) => {
    const tag = req.query.tag as string | undefined;
    res.json({
      notes: agent.getMemoryStore().listNotes(tag)
    });
  });

  // 7. Get Conversation History (Global / legacy)
  router.get('/history', (req, res) => {
    res.json({
      history: agent.getConversationHistory()
    });
  });

  // 8. Key Configuration (Grok, Gemini, ElevenLabs) — Admin-protected
  router.post('/save-key', adminAuthMiddleware, (req, res) => {
    const { provider, apiKey } = req.body;
    if (!provider || typeof apiKey !== 'string') {
      return res.status(400).json({ error: 'provider and apiKey (string) are required.' });
    }

    const trimmedKey = apiKey.replace(/[\r\n\0]/g, '').trim();
    const envVarName = (provider === 'grok' || provider === 'xai')
      ? 'GROK_API_KEY'
      : provider === 'gemini'
      ? 'GEMINI_API_KEY'
      : provider === 'elevenlabs'
      ? 'ELEVENLABS_API_KEY'
      : (provider === 'claude' || provider === 'anthropic')
      ? 'ANTHROPIC_API_KEY'
      : null;

    if (!envVarName) {
      return res.status(400).json({ error: 'Unsupported provider. Supported: grok, gemini, elevenlabs.' });
    }

    process.env[envVarName] = trimmedKey;
    if (envVarName === 'GROK_API_KEY') {
      process.env.XAI_API_KEY = trimmedKey;
      if (trimmedKey.startsWith('gsk_')) {
        process.env.GROQ_API_KEY = trimmedKey;
      }
    }
    agent.getProviderManager().setProviderKey(provider === 'xai' ? 'grok' : provider, trimmedKey);

    // Persist to .env file
    try {
      persistEnvVar(envVarName, trimmedKey);
      if (envVarName === 'GROK_API_KEY') {
        persistEnvVar('XAI_API_KEY', trimmedKey);
        if (trimmedKey.startsWith('gsk_')) {
          persistEnvVar('GROQ_API_KEY', trimmedKey);
        }
      }
    } catch (e: any) {
      console.warn(`Could not persist ${envVarName} to .env:`, sanitizeErrorMessage(e));
    }

    res.json({ success: true, provider, configured: !!trimmedKey });
  });

  // 9. Key Status
  router.get('/key-status', (req, res) => {
    res.json({
      grok: !!(process.env.GROK_API_KEY?.trim() || process.env.XAI_API_KEY?.trim() || process.env.GROQ_API_KEY?.trim()),
      gemini: !!(process.env.GEMINI_API_KEY?.trim()),
      elevenlabs: !!(process.env.ELEVENLABS_API_KEY?.trim()),
      supabase: isSupabaseConfigured()
    });
  });

  // 10. Supabase Database Endpoints
  router.get('/supabase/status', async (req, res) => {
    try {
      const isConfigured = isSupabaseConfigured();
      const credentials = getSupabaseCredentials();
      const connection = await testSupabaseConnection();
      res.json({
        isConfigured,
        url: credentials.url ? credentials.url.replace(/^(https?:\/\/[^.]+).*/, '$1.supabase.co') : '',
        connection
      });
    } catch (err: any) {
      res.status(500).json({ error: sanitizeErrorMessage(err) });
    }
  });

  router.post('/supabase/config', adminAuthMiddleware, async (req, res) => {
    const { url, key } = req.body;
    if (!url || !key || typeof url !== 'string' || typeof key !== 'string') {
      return res.status(400).json({ error: 'Both "url" and "key" are required to connect Supabase.' });
    }

    const cleanUrl = sanitizeString(url, 256).replace(/[\r\n\0]/g, '').trim();
    const cleanKey = sanitizeString(key, 512).replace(/[\r\n\0]/g, '').trim();
    if (!cleanUrl.startsWith('https://') || !isSafeHttpUrl(cleanUrl)) {
      return res.status(400).json({ error: 'Invalid Supabase URL. Must be a valid https:// endpoint.' });
    }

    try {
      updateSupabaseCredentials(cleanUrl, cleanKey);
      persistEnvVar('SUPABASE_URL', cleanUrl);
      persistEnvVar('SUPABASE_ANON_KEY', cleanKey);
      // Server-only persistence: client never receives direct secret key credentials

      const testResult = await testSupabaseConnection();
      let syncResult = null;
      if (testResult.connected) {
        syncResult = await agent.getMemoryStore().syncAllToSupabase();
      }

      res.json({
        success: true,
        connection: testResult,
        sync: syncResult
      });
    } catch (err: any) {
      res.status(500).json({ error: sanitizeErrorMessage(err) });
    }
  });

  router.post('/supabase/sync', adminAuthMiddleware, async (req, res) => {
    try {
      const { direction } = req.body;
      const memoryStore = agent.getMemoryStore();

      let pushResult = null;
      let pullResult = null;

      if (direction === 'pull' || direction === 'both' || !direction) {
        pullResult = await memoryStore.syncFromSupabase();
      }
      if (direction === 'push' || direction === 'both' || !direction) {
        pushResult = await memoryStore.syncAllToSupabase();
      }

      res.json({
        success: true,
        pull: pullResult,
        push: pushResult
      });
    } catch (err: any) {
      res.status(500).json({ error: sanitizeErrorMessage(err) });
    }
  });

  return router;
}
