import axios from 'axios';
import { IAIProvider } from './IAIProvider';
import { AgentMessage, ToolDefinition, AgentConfig, ProviderResponse } from '../types';

export class GrokProvider implements IAIProvider {
  private baseUrl: string;
  private defaultModel: string;
  private apiKey: string;
  private cachedAvailable: boolean | null = null;
  private cacheExpiry: number = 0;

  constructor(
    apiKey = process.env.GROK_API_KEY || process.env.XAI_API_KEY || process.env.GROQ_API_KEY || '',
    baseUrl = process.env.GROK_BASE_URL || '',
    defaultModel = process.env.GROK_MODEL || ''
  ) {
    this.apiKey = apiKey.trim();
    // Determine provider type from the key itself only. Using !!process.env.GROQ_API_KEY
    // here would cause an xAI key (picked via GROK_API_KEY) to be mistakenly routed to
    // the Groq endpoint when both env vars are set.
    const isGroq = this.apiKey.startsWith('gsk_');
    this.baseUrl = baseUrl.replace(/\/$/, '') || (isGroq ? 'https://api.groq.com/openai/v1' : 'https://api.x.ai/v1');
    this.defaultModel = defaultModel || (isGroq ? 'llama-3.3-70b-versatile' : 'grok-4.7');
  }

  getName(): string {
    return 'grok';
  }

  getApiKey(): string {
    return this.apiKey || process.env.GROK_API_KEY || process.env.XAI_API_KEY || process.env.GROQ_API_KEY || '';
  }

  setApiKey(key: string): void {
    this.apiKey = key.trim();
    if (!this.apiKey) {
      // When the key is cleared, re-derive the endpoint from env vars so that a
      // lingering GROQ_API_KEY in the environment isn't accidentally routed to
      // the xAI endpoint.
      const envKey = process.env.GROK_API_KEY || process.env.XAI_API_KEY || process.env.GROQ_API_KEY || '';
      const isGroqEnv = envKey.startsWith('gsk_');
      this.baseUrl = isGroqEnv ? 'https://api.groq.com/openai/v1' : 'https://api.x.ai/v1';
      this.defaultModel = isGroqEnv ? 'llama-3.3-70b-versatile' : 'grok-4.7';
    } else {
      const isGroq = this.apiKey.startsWith('gsk_');
      if (isGroq) {
        this.baseUrl = 'https://api.groq.com/openai/v1';
        this.defaultModel = 'llama-3.3-70b-versatile';
      } else {
        this.baseUrl = 'https://api.x.ai/v1';
        this.defaultModel = 'grok-4.7';
      }
    }
    this.cachedAvailable = null;
    this.cacheExpiry = 0;
  }

  async isAvailable(): Promise<boolean> {
    const key = this.getApiKey();
    if (!key) return false;

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
        details: 'Grok API Key not configured. Add your xAI key in settings or .env (GROK_API_KEY / XAI_API_KEY).'
      };
    }

    try {
      const res = await axios.get(`${this.baseUrl}/models`, {
        headers: { Authorization: `Bearer ${key}` },
        timeout: 4000
      });
      const models: string[] = (res.data?.data || []).map((m: any) => m.id);
      const isGroq = this.baseUrl.includes('groq.com');

      let chosen = this.defaultModel;
      if (models.includes(this.defaultModel)) {
        chosen = this.defaultModel;
      } else if (!isGroq) {
        // xAI models priority: grok-4.7, grok-4, grok-3-latest, grok-3, grok-2-latest
        const preferenceList = [
          'grok-4.7',
          'grok-4',
          'grok-3-latest',
          'grok-3',
          'grok-2-latest',
          'grok-2',
          'grok-beta'
        ];
        const match = preferenceList.find(pref => models.includes(pref)) 
          || models.find((m: string) => m.startsWith('grok-4') || m.startsWith('grok-3') || m.startsWith('grok-2') || m.includes('grok'));
        chosen = match || this.defaultModel;
      } else {
        chosen = models.find((m: string) => m.includes('llama-3.3') || m.includes('llama')) || this.defaultModel;
      }

      this.defaultModel = chosen;

      return {
        name: chosen,
        available: true,
        details: isGroq ? `Groq Cloud: ${chosen}` : `xAI Cloud: ${chosen}`
      };
    } catch (err: any) {
      const rawError = err.response?.data?.error;
      const apiError = typeof rawError === 'string' ? rawError : (rawError?.message || err.response?.data?.message || err.message);
      return {
        name: this.defaultModel,
        available: false,
        details: `xAI Grok API error: ${apiError}`
      };
    }
  }

  private getCandidateModels(explicitModel?: string): string[] {
    if (explicitModel) return [explicitModel];
    const isGroq = this.baseUrl.includes('groq.com');
    if (isGroq) {
      return Array.from(new Set([this.defaultModel, 'llama-3.3-70b-versatile', 'llama-3.1-8b-instant']));
    }
    // xAI candidate priority
    return Array.from(new Set([this.defaultModel, 'grok-4.7', 'grok-4', 'grok-3-latest', 'grok-2-latest']));
  }

  async generateResponse(
    messages: AgentMessage[],
    tools: ToolDefinition[],
    config: AgentConfig
  ): Promise<ProviderResponse> {
    const key = this.getApiKey();
    if (!key) {
      throw new Error('Grok API Key is required. Please set GROK_API_KEY / XAI_API_KEY or configure it in the Control Panel.');
    }

    // Convert tool definitions to strictly compliant JSON Schema for xAI function calling
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

    // Format messages for OpenAI compatibility
    const formattedMessages = messages.map((m) => {
      const base: any = {
        role: m.role,
        content: m.content || ''
      };
      if (m.toolCalls && m.toolCalls.length > 0) {
        base.tool_calls = m.toolCalls.map((tc) => ({
          id: tc.id,
          type: 'function',
          function: {
            name: tc.name,
            arguments: JSON.stringify(tc.arguments)
          }
        }));
      }
      if (m.role === 'tool' && m.toolCallId) {
        base.tool_call_id = m.toolCallId;
      }
      return base;
    });

    const candidateModels = this.getCandidateModels(config.modelName);
    let lastError: any = null;

    for (const model of candidateModels) {
      const payload: any = {
        model,
        messages: formattedMessages,
        temperature: config.temperature ?? 0.7,
        max_tokens: config.maxTokens || 2048
      };

      if (formattedTools.length > 0) {
        payload.tools = formattedTools;
        payload.tool_choice = 'auto';
      }

      try {
        const res = await axios.post(`${this.baseUrl}/chat/completions`, payload, {
          headers: {
            Authorization: `Bearer ${key}`,
            'Content-Type': 'application/json'
          },
          timeout: 25000
        });

        const choice = res.data?.choices?.[0];
        const message = choice?.message;

        if (!message) {
          throw new Error('No message returned from Grok API');
        }

        // Remember the model that succeeded
        if (!config.modelName && this.defaultModel !== model) {
          this.defaultModel = model;
        }

        const content = message.content || '';
        const toolCalls: Array<{ id: string; name: string; arguments: Record<string, any> }> = [];

        if (message.tool_calls && Array.isArray(message.tool_calls)) {
          for (const tc of message.tool_calls) {
            let parsedArgs = {};
            try {
              parsedArgs = typeof tc.function.arguments === 'string'
                ? JSON.parse(tc.function.arguments)
                : tc.function.arguments || {};
            } catch (parseErr) {
              console.warn('Failed to parse Grok tool arguments:', tc.function.arguments);
            }

            toolCalls.push({
              id: tc.id || `call_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
              name: tc.function.name,
              arguments: parsedArgs
            });
          }
        }

        return {
          content,
          toolCalls: toolCalls.length > 0 ? toolCalls : undefined
        };
      } catch (err: any) {
        lastError = err;
        const rawError = err.response?.data?.error;
        const apiError = typeof rawError === 'string' ? rawError : (rawError?.message || err.response?.data?.message || err.message);
        const status = err.response?.status;

        // Immediately abort candidate loop on authentication failure
        if (status === 401 || (status === 400 && typeof apiError === 'string' && apiError.toLowerCase().includes('api key'))) {
          throw new Error(`xAI Grok error: ${apiError}`);
        }

        console.warn(`Grok model ${model} attempt failed (${apiError}), trying next candidate if available...`);
      }
    }

    const rawLast = lastError?.response?.data?.error;
    const apiError = typeof rawLast === 'string' ? rawLast : (rawLast?.message || lastError?.response?.data?.message || lastError?.message);
    console.warn('Grok generateResponse error:', apiError);
    throw new Error(`xAI Grok error: ${apiError}`);
  }

  async generateResponseStream(
    messages: AgentMessage[],
    tools: ToolDefinition[],
    config: AgentConfig,
    onChunk: (delta: string) => void,
    signal?: AbortSignal
  ): Promise<ProviderResponse> {
    if (tools.length > 0 && config.toolsEnabled !== false) {
      return this.generateResponse(messages, tools, config);
    }

    const key = this.getApiKey();
    if (!key) {
      throw new Error('xAI Grok API Key is required.');
    }

    const candidateModels = this.getCandidateModels(config.modelName);
    const model = candidateModels[0] || this.defaultModel;
    const formattedMessages = messages.map((m) => ({
      role: m.role === 'system' ? 'system' : (m.role === 'assistant' ? 'assistant' : 'user'),
      content: m.content || ''
    }));

    const payload: any = {
      model,
      messages: formattedMessages,
      temperature: config.temperature ?? 0.7,
      max_tokens: config.maxTokens || 1200,
      stream: true
    };

    try {
      const res = await axios.post(`${this.baseUrl}/chat/completions`, payload, {
        headers: {
          Authorization: `Bearer ${key}`,
          'Content-Type': 'application/json'
        },
        responseType: 'stream',
        timeout: 20000,
        signal
      });

      let fullContent = '';

      return new Promise<ProviderResponse>((resolve, reject) => {
        let streamBuffer = '';

        res.data.on('data', (chunk: Buffer) => {
          streamBuffer += chunk.toString();
          const lines = streamBuffer.split('\n');
          streamBuffer = lines.pop() || '';

          for (const line of lines) {
            const trimmed = line.trim();
            if (trimmed.startsWith('data: ') && trimmed !== 'data: [DONE]') {
              try {
                const parsed = JSON.parse(trimmed.slice(6));
                const delta = parsed.choices?.[0]?.delta?.content || '';
                if (delta) {
                  fullContent += delta;
                  onChunk(delta);
                }
              } catch {}
            }
          }
        });

        res.data.on('end', () => {
          resolve({ content: fullContent });
        });

        res.data.on('error', (err: any) => {
          if (fullContent) {
            resolve({ content: fullContent });
          } else {
            reject(err);
          }
        });
      });
    } catch (err: any) {
      const fallback = await this.generateResponse(messages, tools, config);
      if (fallback.content) {
        onChunk(fallback.content);
      }
      return fallback;
    }
  }
}
