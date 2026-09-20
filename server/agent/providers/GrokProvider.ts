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
    const isGroq = this.apiKey.startsWith('gsk_') || !!process.env.GROQ_API_KEY;
    this.baseUrl = baseUrl.replace(/\/$/, '') || (isGroq ? 'https://api.groq.com/openai/v1' : 'https://api.x.ai/v1');
    this.defaultModel = defaultModel || (isGroq ? 'llama-3.3-70b-versatile' : 'grok-2-latest');
  }

  getName(): string {
    return 'grok';
  }

  getApiKey(): string {
    return this.apiKey || process.env.GROK_API_KEY || process.env.XAI_API_KEY || process.env.GROQ_API_KEY || '';
  }

  setApiKey(key: string): void {
    this.apiKey = key.trim();
    const isGroq = this.apiKey.startsWith('gsk_');
    if (isGroq && !this.baseUrl.includes('groq')) {
      this.baseUrl = 'https://api.groq.com/openai/v1';
      this.defaultModel = 'llama-3.3-70b-versatile';
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
        timeout: 1800
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
      
      // Look for grok-4.6, or latest grok models
      const chosen = models.includes(this.defaultModel)
        ? this.defaultModel
        : models.find((m: string) => m.includes('4.6') || m.includes('grok-2') || m.includes('grok-beta')) || this.defaultModel;

      return {
        name: chosen,
        available: true,
        details: `xAI Cloud: ${chosen} (Grok 4.6 flagship intelligence)`
      };
    } catch (err: any) {
      return {
        name: this.defaultModel,
        available: false,
        details: `xAI Grok API error: ${err.response?.data?.error?.message || err.message}`
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
      throw new Error('Grok API Key is required. Please set GROK_API_KEY / XAI_API_KEY or configure it in the Control Panel.');
    }

    const model = config.modelName || this.defaultModel;

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

    const payload: any = {
      model,
      messages: formattedMessages,
      temperature: config.temperature ?? 0.7,
      max_tokens: 350
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
        timeout: 2500
      });

      const choice = res.data?.choices?.[0];
      const message = choice?.message;

      if (!message) {
        throw new Error('No message returned from Grok API');
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
      const apiError = err.response?.data?.error?.message || err.response?.data?.message || err.message;
      console.warn('Grok generateResponse error:', apiError);
      throw new Error(`xAI Grok error: ${apiError}`);
    }
  }
}
