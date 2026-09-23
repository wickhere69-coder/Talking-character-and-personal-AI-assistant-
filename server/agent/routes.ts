import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import { AgentCore } from './AgentCore';

export function createAgentRouter(): Router {
  const router = Router();
  const agent = new AgentCore();

  // 1. Main Chat Endpoint
  router.post('/chat', async (req, res) => {
    const { message, config } = req.body;
    if (!message || typeof message !== 'string') {
      return res.status(400).json({ error: 'Field "message" is required and must be a string.' });
    }

    try {
      const response = await agent.handleUserMessage(message, config || {});
      res.json(response);
    } catch (err: any) {
      console.error('Agent chat error:', err);
      res.status(500).json({
        response: `I ran into an unexpected error: ${err.message}`,
        status: 'error',
        error: err.message,
        modelUsed: 'error_handler'
      });
    }
  });

  // 1b. Real-time Streaming Endpoint (SSE for Conversational Mode)
  router.post('/stream', async (req, res) => {
    const { message, config } = req.body;
    if (!message || typeof message !== 'string') {
      return res.status(400).json({ error: 'Field "message" is required and must be a string.' });
    }

    // Set SSE headers
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();

    const abortController = new AbortController();
    // Only abort if the client actually disconnects or closes the response connection early
    res.on('close', () => {
      if (!res.writableEnded) {
        abortController.abort();
      }
    });

    try {
      const result = await agent.handleUserMessageStream(
        message,
        config || {},
        (chunk: string) => {
          if (!res.writableEnded) {
            res.write(`data: ${JSON.stringify({ chunk })}\n\n`);
          }
        },
        abortController.signal
      );

      if (!res.writableEnded) {
        res.write(`data: ${JSON.stringify({ done: true, fullResponse: result.response, modelUsed: result.modelUsed })}\n\n`);
        res.end();
      }
    } catch (err: any) {
      console.error('Agent stream error:', err);
      if (!res.writableEnded) {
        res.write(`data: ${JSON.stringify({ error: err.message || 'Stream processing failed' })}\n\n`);
        res.end();
      }
    }
  });

  // 2. Confirmation Resolution
  router.post('/confirm', async (req, res) => {
    const { confirmationId, approved } = req.body;
    if (!confirmationId || typeof approved !== 'boolean') {
      return res.status(400).json({ error: 'confirmationId and approved (boolean) are required.' });
    }

    try {
      const response = await agent.resolveConfirmation(confirmationId, approved);
      res.json(response);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // 3. Health & Diagnostics
  router.get('/health', async (req, res) => {
    try {
      const providerHealth = await agent.getProviderManager().getHealth();
      const tools = agent.getToolRegistry().getAllDefinitions();
      const memory = agent.getMemoryStore();

      res.json({
        status: 'healthy',
        timestamp: Date.now(),
        provider: providerHealth,
        toolsRegistered: tools.length,
        memoryItems: memory.getAllMemories().length,
        tasksCount: memory.listTasks().length,
        notesCount: memory.listNotes().length,
        diagnostics: {
          offlineReady: true,
          freeTierOnly: true,
          toolsAvailable: tools.map((t) => t.name)
        }
      });
    } catch (err: any) {
      res.status(500).json({ status: 'unhealthy', error: err.message });
    }
  });

  // 4. List Tools
  router.get('/tools', (req, res) => {
    const tools = agent.getToolRegistry().getAllDefinitions();
    res.json({
      total: tools.length,
      tools
    });
  });

  // 5. Memory View
  router.get('/memory', (req, res) => {
    const memory = agent.getMemoryStore();
    res.json({
      memories: memory.getAllMemories(),
      tasks: memory.listTasks(),
      notes: memory.listNotes(),
      preferences: memory.getPreferences()
    });
  });

  // 6. Clear History
  router.post('/clear-history', (req, res) => {
    agent.clearContext();
    res.json({ success: true, message: 'Conversation history cleared.' });
  });

  // 7. Get Conversation History
  router.get('/history', (req, res) => {
    res.json({
      history: agent.getConversationHistory()
    });
  });

  // 8. Key Configuration (Grok, Gemini, ElevenLabs)
  router.post('/save-key', (req, res) => {
    const { provider, apiKey } = req.body;
    if (!provider || typeof apiKey !== 'string') {
      return res.status(400).json({ error: 'provider and apiKey (string) are required.' });
    }

    const trimmedKey = apiKey.trim();
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
      return res.status(400).json({ error: `Unsupported provider "${provider}". Supported: grok, gemini, elevenlabs.` });
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
    const safeKey = trimmedKey.replace(/[\r\n]/g, '');
    const escapedKey = safeKey.replace(/\$/g, '$$$$');
    try {
      const envPath = path.resolve(process.cwd(), '.env');
      let envContent = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';
      const regex = new RegExp(`^${envVarName}=.*$`, 'm');
      if (regex.test(envContent)) {
        envContent = envContent.replace(regex, `${envVarName}=${escapedKey}`);
      } else {
        envContent += `\n${envVarName}=${safeKey}\n`;
      }
      if (envVarName === 'GROK_API_KEY') {
        const xaiRegex = /^XAI_API_KEY=.*$/m;
        if (xaiRegex.test(envContent)) {
          envContent = envContent.replace(xaiRegex, `XAI_API_KEY=${escapedKey}`);
        } else {
          envContent += `\nXAI_API_KEY=${safeKey}\n`;
        }
        if (safeKey.startsWith('gsk_')) {
          const groqRegex = /^GROQ_API_KEY=.*$/m;
          if (groqRegex.test(envContent)) {
            envContent = envContent.replace(groqRegex, `GROQ_API_KEY=${escapedKey}`);
          } else {
            envContent += `\nGROQ_API_KEY=${safeKey}\n`;
          }
        }
      }
      fs.writeFileSync(envPath, envContent);
    } catch (e: any) {
      console.warn(`Could not persist ${envVarName} to .env:`, e.message);
    }

    res.json({ success: true, provider, configured: !!trimmedKey });
  });

  // 9. Key Status
  router.get('/key-status', (req, res) => {
    res.json({
      grok: !!(process.env.GROK_API_KEY?.trim() || process.env.XAI_API_KEY?.trim() || process.env.GROQ_API_KEY?.trim()),
      gemini: !!(process.env.GEMINI_API_KEY?.trim()),
      elevenlabs: !!(process.env.ELEVENLABS_API_KEY?.trim())
    });
  });

  return router;
}
