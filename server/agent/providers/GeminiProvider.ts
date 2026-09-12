import axios from 'axios';
import { IAIProvider } from './IAIProvider';
import { AgentMessage, ToolDefinition, AgentConfig, ProviderResponse } from '../types';

export class GeminiProvider implements IAIProvider {
  private baseUrl: string;
  private defaultModel: string;
  private apiKey: string;

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
  }

  async isAvailable(): Promise<boolean> {
    const key = this.getApiKey();
    if (!key) return false;
    try {
      const res = await axios.get(`${this.baseUrl}/models`, {
        headers: { Authorization: `Bearer ${key}` },
        timeout: 3500
      });
      return res.status === 200;
    } catch {
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
        timeout: 3500
      });
      const rawModels = (res.data?.data || []).map((m: any) => m.id);
      const cleanModels = rawModels.map((id: string) => id.replace(/^models\//, ''));

      const chosen = cleanModels.includes(this.defaultModel)
        ? this.defaultModel
        : cleanModels.find((m: string) => m.includes('gemini-3.8') || m.includes('gemini-3.6') || m.includes('gemini-3.5')) || this.defaultModel;

      return {
        name: chosen,
        available: true,
        details: `Google Gemini Cloud: ${chosen} (High-speed multimodal intelligence)`
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

    // Format messages for OpenAI compatibility
    const formattedMessages = messages.map((m) => {
      const base: any = {
        role: m.role,
        content: m.content || ''
      };
      if (m.toolCalls && m.toolCalls.length > 0) {
        base.tool_calls = m.toolCalls.map((tc) => {
          const item: any = {
            id: tc.id,
            type: 'function',
            function: {
              name: tc.name,
              arguments: JSON.stringify(tc.arguments)
            }
          };
          if (tc.extraContent) {
            item.extra_content = tc.extraContent;
          }
          return item;
        });
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
      max_tokens: 1024
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
        timeout: 20000
      });
    } catch (err: any) {
      const status = err.response?.status;
      if ((status === 404 || status === 503) && payload.model !== 'gemini-3.6-flash') {
        console.warn(`Model ${payload.model} unavailable (${status}), falling back to gemini-3.6-flash`);
        this.defaultModel = 'gemini-3.6-flash';
        payload.model = 'gemini-3.6-flash';
        res = await axios.post(`${this.baseUrl}/chat/completions`, payload, {
          headers: {
            Authorization: `Bearer ${key}`,
            'Content-Type': 'application/json'
          },
          timeout: 20000
        });
      } else {
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
