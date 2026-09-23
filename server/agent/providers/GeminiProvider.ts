import axios from 'axios';
import { IAIProvider } from './IAIProvider';
import { AgentMessage, ToolDefinition, AgentConfig, ProviderResponse } from '../types';

export class GeminiProvider implements IAIProvider {
  private baseUrl: string;
  private defaultModel: string;
  private apiKey: string;
  private cachedAvailable: boolean | null = null;
  private cacheExpiry: number = 0;

  constructor(
    apiKey = process.env.GEMINI_API_KEY || '',
    baseUrl = 'https://generativelanguage.googleapis.com/v1beta/openai',
    defaultModel = process.env.GEMINI_MODEL || 'models/gemini-3.8-flash'
  ) {
    this.apiKey = apiKey.trim();
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.defaultModel = defaultModel;
  }

  getName(): string {
    return 'gemini';
  }

  getApiKey(): string {
    return this.apiKey || process.env.GEMINI_API_KEY || '';
  }

  setApiKey(key: string): void {
    this.apiKey = key.trim();
    this.cachedAvailable = null;
    this.cacheExpiry = 0;
  }

  async isAvailable(): Promise<boolean> {
    const key = this.getApiKey();
    if (!key) return false;
    
    // Return cached availability if valid (TTL: 60s)
    const now = Date.now();
    if (this.cachedAvailable !== null && now < this.cacheExpiry) {
      return this.cachedAvailable;
    }

    try {
      const res = await axios.get(`${this.baseUrl}/models`, {
        headers: { Authorization: `Bearer ${key}` },
        timeout: 5000
      });
      this.cachedAvailable = res.status === 200;
      this.cacheExpiry = now + 60000;
      return this.cachedAvailable;
    } catch {
      this.cachedAvailable = false;
      this.cacheExpiry = now + 15000;
      return false;
    }
  }

  async getModelInfo(): Promise<{ name: string; available: boolean; details?: string }> {
    const key = this.getApiKey();
    if (!key) {
      return {
        name: this.defaultModel,
        available: false,
        details: 'Gemini API Key not configured. Add your free key in settings or .env (GEMINI_API_KEY).'
      };
    }

    try {
      const res = await axios.get(`${this.baseUrl}/models`, {
        headers: { Authorization: `Bearer ${key}` },
        timeout: 6000
      });
      const rawModels = (res.data?.data || []).map((m: any) => m.id);
      const cleanModels = rawModels.map((id: string) => id.replace(/^models\//, ''));

      // cleanModels has the 'models/' prefix stripped; this.defaultModel may carry it.
      const normalizedDefault = this.defaultModel.replace(/^models\//, '');
      const chosen = cleanModels.includes(normalizedDefault)
        ? normalizedDefault
        : cleanModels.find((m: string) => m.includes('3.8-flash') || m.includes('3.5-flash') || m.includes('flash')) || 'gemini-3.8-flash';

      return {
        name: chosen,
        available: true,
        details: `Google Gemini Cloud: ${chosen} (Ultra-fast flash intelligence)`
      };
    } catch (err: any) {
      return {
        name: this.defaultModel,
        available: false,
        details: `Gemini API error: ${err.response?.data?.error?.message || err.message}`
      };
    }
  }

  async generateResponse(
    messages: AgentMessage[],
    tools: ToolDefinition[],
    config: AgentConfig
  ): Promise<ProviderResponse> {
    const key = this.getApiKey();
    if (!key) {
      throw new Error('Google Gemini API Key is required. Please set GEMINI_API_KEY or configure it in the Control Panel.');
    }

    const model = config.modelName || this.defaultModel;

    // Convert tool definitions to strictly compliant JSON Schema
    const formattedTools = tools.map((t) => {
      const properties: Record<string, any> = {};
      const required: string[] = [];

      for (const [propKey, prop] of Object.entries(t.parameters)) {
        properties[propKey] = {
          type: prop.type,
          description: prop.description
        };
        if (prop.enum) {
          properties[propKey].enum = prop.enum;
        }
        if (prop.required) {
          required.push(propKey);
        }
      }

      return {
        type: 'function',
        function: {
          name: t.name,
          description: t.description,
          parameters: {
            type: 'object',
            properties,
            required
          }
        }
      };
    });

    // Format messages for Gemini OpenAI-compatible endpoint
    const formattedMessages: any[] = [];
    for (const m of messages) {
      if (m.role === 'tool') {
        formattedMessages.push({
          role: 'user',
          content: `[Information Retrieved]:\n${m.content || ''}\n\nPlease synthesize this into a full, natural, and articulate spoken answer.`
        });
      } else if (m.role === 'assistant' && m.toolCalls && m.toolCalls.length > 0 && !m.content) {
        formattedMessages.push({
          role: 'assistant',
          content: 'Let me look that up for you right now.'
        });
      } else {
        formattedMessages.push({
          role: m.role === 'system' ? 'system' : (m.role === 'assistant' ? 'assistant' : 'user'),
          content: m.content || ''
        });
      }
    }

    const modelToUse = model.startsWith('models/') ? model : `models/${model}`;

    const payload: any = {
      model: modelToUse,
      messages: formattedMessages,
      temperature: config.temperature ?? 0.7,
      max_tokens: config.maxTokens || 2048
    };

    if (formattedTools.length > 0 && config.toolsEnabled !== false) {
      payload.tools = formattedTools;
      payload.tool_choice = 'auto';
    }

    let res: any;
    try {
      res = await axios.post(`${this.baseUrl}/chat/completions`, payload, {
        headers: {
          Authorization: `Bearer ${key}`,
          'Content-Type': 'application/json'
        },
        timeout: 25000
      });
    } catch (err: any) {
      const fallbackCandidates = ['models/gemini-3.5-flash', 'models/gemini-3.1-pro-preview'].filter((m) => m !== payload.model);

      let succeeded = false;
      for (const altModel of fallbackCandidates) {
        try {
          payload.model = altModel;
          res = await axios.post(`${this.baseUrl}/chat/completions`, payload, {
            headers: {
              Authorization: `Bearer ${key}`,
              'Content-Type': 'application/json'
            },
            timeout: 20000
          });
          this.defaultModel = altModel;
          succeeded = true;
          break;
        } catch {}
      }

      if (!succeeded) {
        throw err;
      }
    }

    const choice = res.data?.choices?.[0];
    const message = choice?.message;

    let content = message?.content || '';
    const toolCalls: Array<{ id: string; name: string; arguments: Record<string, any>; extraContent?: any }> = [];

    if (message?.tool_calls && Array.isArray(message.tool_calls)) {
      for (const tc of message.tool_calls) {
        if (tc.type === 'function' && tc.function) {
          let parsedArgs = {};
          try {
            parsedArgs = typeof tc.function.arguments === 'string'
              ? JSON.parse(tc.function.arguments)
              : tc.function.arguments;
          } catch {
            parsedArgs = {};
          }
          toolCalls.push({
            id: tc.id || `tc_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
            name: tc.function.name,
            arguments: parsedArgs,
            extraContent: tc.extra_content
          });
        }
      }
    }

    return {
      content,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined
    };
  }

  async generateResponseStream(
    messages: AgentMessage[],
    tools: ToolDefinition[],
    config: AgentConfig,
    onChunk: (delta: string) => void,
    signal?: AbortSignal
  ): Promise<ProviderResponse> {
    // If tools are provided, run standard response to allow tool execution
    if (tools.length > 0 && config.toolsEnabled !== false) {
      return this.generateResponse(messages, tools, config);
    }

    const key = this.getApiKey();
    if (!key) {
      throw new Error('Google Gemini API Key is required.');
    }

    const isConversational = config.mode === 'conversational' || config.mode === 'chat';
    const streamTimeout = isConversational ? 8000 : 12000;
    const maxTokens = Math.max(config.maxTokens || 0, isConversational ? 2048 : 2048);

    const explicitSystem = messages.find((m) => m.role === 'system')?.content || '';
    const voiceDirective = isConversational
      ? 'You are a helpful, precise AI voice assistant. Answer the user directly and accurately in 2 to 4 natural spoken sentences. Be conversational, warm, and concise. Do not deflect or evade. Never use markdown asterisks, hashtags, or bullet lists in your response.'
      : '';
    const systemPrompt = [voiceDirective, explicitSystem].filter(Boolean).join('\n\n');

    const userOrAssistantMessages = messages.filter((m) => m.role !== 'system');
    const contents = userOrAssistantMessages.map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content || '' }]
    }));
    if (contents.length === 0) {
      contents.push({ role: 'user', parts: [{ text: 'Hello' }] });
    }

    const nativeCandidates = [
      'gemini-3.8-flash',
      'gemini-3.5-flash',
      'gemini-3.1-pro-preview'
    ];

    for (const candidateModel of nativeCandidates) {
      const innerAbort = new AbortController();
      // Keep a reference to the listener so we can remove it after the attempt,
      // preventing multiple listeners from accumulating on the shared outer signal
      // across retry iterations.
      const abortRelay = () => innerAbort.abort();
      if (signal) {
        signal.addEventListener('abort', abortRelay);
      }

      try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${candidateModel}:streamGenerateContent?alt=sse&key=${key}`;
        const payload: any = {
          contents,
          generationConfig: {
            temperature: config.temperature ?? 0.7,
            maxOutputTokens: maxTokens,
            thinkingConfig: {
              thinkingBudget: 1024 // High Reasoning Effect
            }
          }
        };
        if (systemPrompt) {
          payload.systemInstruction = { parts: [{ text: systemPrompt }] };
        }

        const res = await axios.post(url, payload, {
          headers: { 'Content-Type': 'application/json' },
          responseType: 'stream',
          timeout: streamTimeout,
          signal: innerAbort.signal
        });

        let fullContent = '';
        let firstChunkTimer: any = null;

        const streamResult = await new Promise<ProviderResponse>((resolve, reject) => {
          let streamBuffer = '';

          firstChunkTimer = setTimeout(() => {
            if (!fullContent) {
              innerAbort.abort();
              try { res.data.destroy(); } catch {}
              reject(new Error(`Native Gemini first token timeout (>7.5s) for ${candidateModel}`));
            }
          }, streamTimeout);

          res.data.on('data', (chunk: Buffer) => {
            if (firstChunkTimer) {
              clearTimeout(firstChunkTimer);
              firstChunkTimer = null;
            }

            streamBuffer += chunk.toString();
            const lines = streamBuffer.split('\n');
            streamBuffer = lines.pop() || '';

            for (const line of lines) {
              const trimmed = line.trim();
              if (trimmed.startsWith('data: ')) {
                try {
                  const parsed = JSON.parse(trimmed.slice(6));
                  // Extract all text parts, cleanly separating out thought tokens from spoken text
                  const parts = parsed.candidates?.[0]?.content?.parts || [];
                  let delta = '';
                  for (const p of parts) {
                    if (p.text) {
                      delta += p.text;
                    }
                  }
                  if (delta) {
                    fullContent += delta;
                    onChunk(delta);
                  }
                } catch {}
              }
            }
          });

          res.data.on('end', () => {
            if (firstChunkTimer) clearTimeout(firstChunkTimer);
            if (fullContent.trim().length > 0) {
              resolve({ content: fullContent });
            } else {
              reject(new Error(`Gemini stream for ${candidateModel} ended with empty text`));
            }
          });

          res.data.on('error', (err: any) => {
            if (firstChunkTimer) clearTimeout(firstChunkTimer);
            if (fullContent.trim().length > 0) {
              resolve({ content: fullContent });
            } else {
              reject(err);
            }
          });
        });

        if (fullContent.trim().length > 0) {
          this.defaultModel = `models/${candidateModel}`;
          if (signal) signal.removeEventListener('abort', abortRelay);
          return streamResult;
        }
      } catch (err: any) {
        if (signal) signal.removeEventListener('abort', abortRelay);
        if (signal?.aborted) throw err;
        if (err?.response?.status === 429) {
          console.warn(`[GEMINI NATIVE STREAM] Free-tier quota reached for candidate ${candidateModel}. Continuing to next candidate model...`);
          continue;
        }
        console.warn(`[GEMINI NATIVE STREAM] Notice on candidate ${candidateModel}:`, err?.message || err);
        continue;
      }
    }

    if (isConversational) {
      throw new Error('Gemini models unavailable, cascading to high-reasoning backup cloud provider');
    }

    const fallback = await this.generateResponse(messages, tools, config);
    if (fallback.content) {
      onChunk(fallback.content);
    }
    return fallback;
  }
}
