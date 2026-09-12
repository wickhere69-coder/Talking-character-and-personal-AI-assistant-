import axios from 'axios';
import { IAIProvider } from './IAIProvider';
import { AgentMessage, ToolDefinition, AgentConfig, ProviderResponse } from '../types';

export class LocalModelProvider implements IAIProvider {
  private baseUrl: string;
  private defaultModel: string;

  constructor(
    baseUrl = process.env.LOCAL_LLM_URL || 'http://127.0.0.1:1234/v1',
    defaultModel = process.env.LOCAL_LLM_MODEL || 'local-model'
  ) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.defaultModel = defaultModel;
  }

  getName(): string {
    return 'local_openai';
  }

  async isAvailable(): Promise<boolean> {
    try {
      const res = await axios.get(`${this.baseUrl}/models`, { timeout: 1500 });
      return res.status === 200;
    } catch {
      return false;
    }
  }

  async getModelInfo(): Promise<{ name: string; available: boolean; details?: string }> {
    try {
      const res = await axios.get(`${this.baseUrl}/models`, { timeout: 1500 });
      const models = (res.data?.data || []).map((m: any) => m.id);
      return {
        name: models[0] || this.defaultModel,
        available: true,
        details: `Local OpenAI endpoint with models: ${models.slice(0, 3).join(', ')}`
      };
    } catch {
      return {
        name: this.defaultModel,
        available: false,
        details: 'Local OpenAI endpoint not running on ' + this.baseUrl
      };
    }
  }

  async generateResponse(
    messages: AgentMessage[],
    tools: ToolDefinition[],
    config: AgentConfig
  ): Promise<ProviderResponse> {
    const model = config.modelName || this.defaultModel;

    const formattedTools = tools.map((t) => {
      const properties: Record<string, any> = {};
      const required: string[] = [];

      for (const [key, prop] of Object.entries(t.parameters)) {
        properties[key] = {
          type: prop.type,
          description: prop.description
        };
        if (prop.enum) {
          properties[key].enum = prop.enum;
        }
        if (prop.required) {
          required.push(key);
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

    const formattedMessages = messages.map((m) => ({
      role: m.role,
      content: m.content
    }));

    try {
      const payload: any = {
        model,
        messages: formattedMessages,
        temperature: config.temperature ?? 0.7
      };

      if (formattedTools.length > 0) {
        payload.tools = formattedTools;
      }

      const res = await axios.post(`${this.baseUrl}/chat/completions`, payload, { timeout: 45000 });
      const choice = res.data?.choices?.[0]?.message;

      const toolCalls: ProviderResponse['toolCalls'] = [];
      if (choice?.tool_calls && Array.isArray(choice.tool_calls)) {
        for (const tc of choice.tool_calls) {
          let args = tc.function?.arguments;
          if (typeof args === 'string') {
            try { args = JSON.parse(args); } catch { args = {}; }
          }
          toolCalls.push({
            id: tc.id || `call_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
            name: tc.function?.name,
            arguments: args || {}
          });
        }
      }

      return {
        content: choice?.content || '',
        toolCalls: toolCalls.length > 0 ? toolCalls : undefined
      };
    } catch (err: any) {
      console.warn('LocalModelProvider notice:', err?.response?.data || err?.message);
      throw new Error(`Local OpenAI request failed: ${err?.message}`);
    }
  }
}
