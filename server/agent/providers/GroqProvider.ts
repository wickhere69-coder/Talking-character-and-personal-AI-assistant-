import axios from 'axios';
import { IAIProvider } from './IAIProvider';
import { AgentMessage, ToolDefinition, AgentConfig, ProviderResponse } from '../types';

export class GroqProvider implements IAIProvider {
  private baseUrl: string;
  private defaultModel: string;
  private apiKey: string;

  constructor(
    apiKey = process.env.GROQ_API_KEY || '',
    baseUrl = 'https://api.groq.com/openai/v1',
    defaultModel = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile'
  ) {
    this.apiKey = apiKey.trim();
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.defaultModel = defaultModel;
  }

  getName(): string {
    return 'groq';
  }

  getApiKey(): string {
    return this.apiKey || process.env.GROQ_API_KEY || '';
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
        timeout: 3000
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
        details: 'Groq API Key not configured. Add your free key in settings or .env (GROQ_API_KEY).'
      };
    }

    try {
      const res = await axios.get(`${this.baseUrl}/models`, {
        headers: { Authorization: `Bearer ${key}` },
        timeout: 3000
      });
      const models = (res.data?.data || []).map((m: any) => m.id);
      const chosen = models.includes(this.defaultModel)
        ? this.defaultModel
        : models.find((m: string) => m.includes('llama-3.3') || m.includes('llama-3.1')) || this.defaultModel;

      return {
        name: chosen,
        available: true,
        details: `Groq Cloud: ${chosen} (Ultra-fast inference)`
      };
    } catch (err: any) {
      return {
        name: this.defaultModel,
        available: false,
        details: `Groq API error: ${err.response?.data?.error?.message || err.message}`
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
      throw new Error('Groq API Key is required. Please set GROQ_API_KEY or configure it in the Control Panel.');
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
      max_tokens: 1024
    };

    if (formattedTools.length > 0 && config.toolsEnabled !== false) {
      payload.tools = formattedTools;
      payload.tool_choice = 'auto';
    }

    const res = await axios.post(`${this.baseUrl}/chat/completions`, payload, {
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json'
      },
      timeout: 20000
    });

    const choice = res.data?.choices?.[0];
    const message = choice?.message;

    let content = message?.content || '';
    const toolCalls: Array<{ id: string; name: string; arguments: Record<string, any> }> = [];

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
            arguments: parsedArgs
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
