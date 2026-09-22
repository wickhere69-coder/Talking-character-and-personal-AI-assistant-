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
    defaultModel = process.env.GEMINI_MODEL || 'gemini-3.8-flash'
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

      const chosen = cleanModels.includes(this.defaultModel)
        ? this.defaultModel
        : cleanModels.find((m: string) => m.includes('3.8-flash') || m.includes('3.6-flash') || m.includes('2.5-flash')) || 'gemini-3.8-flash';

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
        timeout: 14000
      });
    } catch (err: any) {
      const fallbackCandidates = [
        'models/gemini-3.8-flash',
        'models/gemini-3.5-flash-lite',
        'models/gemini-3.1-flash-lite',
        'models/gemini-3-flash-preview',
        'models/gemini-3.7-flash',
        'models/gemini-3.6-flash'
      ].filter((m) => m !== payload.model);

      let succeeded = false;
      for (const altModel of fallbackCandidates) {
        try {
          payload.model = altModel;
          res = await axios.post(`${this.baseUrl}/chat/completions`, payload, {
            headers: {
              Authorization: `Bearer ${key}`,
              'Content-Type': 'application/json'
            },
            timeout: 12000
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
}
