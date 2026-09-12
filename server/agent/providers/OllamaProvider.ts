import axios from 'axios';
import { IAIProvider } from './IAIProvider';
import { AgentMessage, ToolDefinition, AgentConfig, ProviderResponse } from '../types';

export class OllamaProvider implements IAIProvider {
  private baseUrl: string;
  private defaultModel: string;

  constructor(baseUrl = process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434', defaultModel = process.env.OLLAMA_MODEL || 'llama3.2:3b') {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.defaultModel = defaultModel;
  }

  getName(): string {
    return 'ollama';
  }

  async isAvailable(): Promise<boolean> {
    try {
      const res = await axios.get(`${this.baseUrl}/api/tags`, { timeout: 4000 });
      if (res.status !== 200) return false;
      const models = (res.data?.models || []).filter((m: any) => (m.size || 0) > 100000000);
      return Array.isArray(models) && models.length > 0;
    } catch {
      return false;
    }
  }

  async getModelInfo(): Promise<{ name: string; available: boolean; details?: string }> {
    try {
      const res = await axios.get(`${this.baseUrl}/api/tags`, { timeout: 1500 });
      const localModels = (res.data?.models || []).filter((m: any) => (m.size || 0) > 100000000);
      const names = localModels.map((m: any) => m.name);
      // Prioritize llama3.2:3b for native function/tool calling support in Ollama
      const chosenModel = names.find((m: string) => m.includes('llama3.2:3b'))
        || names.find((m: string) => m.includes('llama3.2:1b'))
        || names.find((m: string) => m.includes('qwen2.5:1.5b'))
        || names[0]
        || this.defaultModel;
      return {
        name: chosenModel,
        available: names.length > 0,
        details: names.length > 0
          ? `Ollama: ${chosenModel} (${names.length} local model(s) available)`
          : 'Ollama running, but no models installed. Run "ollama pull llama3.2:3b" to install one.'
      };
    } catch {
      return {
        name: this.defaultModel,
        available: false,
        details: 'Ollama service not running on ' + this.baseUrl
      };
    }
  }

  async generateResponse(
    messages: AgentMessage[],
    tools: ToolDefinition[],
    config: AgentConfig
  ): Promise<ProviderResponse> {
    let model = config.modelName || this.defaultModel;

    // Auto-resolve to actual installed model name, prioritizing llama3.2:3b for native tools
    try {
      const tagRes = await axios.get(`${this.baseUrl}/api/tags`, { timeout: 1500 });
      const availableModels: string[] = (tagRes.data?.models || [])
        .filter((m: any) => (m.size || 0) > 100000000)
        .map((m: any) => m.name);
      if (availableModels.length > 0) {
        if (!config.modelName) {
          model = availableModels.find((m) => m.includes('llama3.2:3b'))
            || availableModels.find((m) => m.includes('llama3.2:1b'))
            || availableModels.find((m) => m.includes('qwen2.5:1.5b'))
            || availableModels[0];
        } else {
          const match = availableModels.find(
            (m: string) => m === model || m.startsWith(`${model}:`) || m.includes(model)
          );
          if (match) model = match;
        }
      }
    } catch {
      // Continue with requested model
    }

    // Convert tool definitions to strictly compliant JSON Schema (no boolean required in properties)
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

    // Format chat messages
    const formattedMessages = messages.map((m) => {
      if (m.role === 'tool') {
        return {
          role: 'user',
          content: `[Real-Time Live Web Search / Tool Result]:\n${m.content}\nSynthesize this into an accurate, natural spoken answer to the user's question.`
        };
      }
      const base: any = { role: m.role, content: m.content };
      if (m.toolCalls && m.toolCalls.length > 0) {
        base.tool_calls = m.toolCalls.map((tc) => ({
          id: tc.id,
          type: 'function',
          function: {
            name: tc.name,
            arguments: tc.arguments
          }
        }));
      }
      return base;
    });

    try {
      const isChat = config.mode === 'chat';
      const payload: any = {
        model,
        messages: formattedMessages,
        stream: false,
        keep_alive: '24h',
        options: {
          temperature: config.temperature ?? 0.7,
          top_k: 40,
          top_p: 0.9,
          num_ctx: 2048,
          num_predict: 256,
          num_thread: 8
        }
      };

      // Only pass tools when relevant tools are present
      if (config.toolsEnabled !== false && !isChat && formattedTools.length > 0) {
        payload.tools = formattedTools;
      }

      let res: any;
      try {
        res = await axios.post(`${this.baseUrl}/api/chat`, payload, { timeout: 25000 });
      } catch (err: any) {
        // If the model does not support tool calling, retry without tools
        const errStr = (err?.response?.data?.error || err?.message || '').toLowerCase();
        if (payload.tools && (errStr.includes('tool') || errStr.includes('support'))) {
          delete payload.tools;
          res = await axios.post(`${this.baseUrl}/api/chat`, payload, { timeout: 25000 });
        } else {
          throw err;
        }
      }

      const msg = res.data?.message;

      const toolCalls: ProviderResponse['toolCalls'] = [];
      if (msg?.tool_calls && Array.isArray(msg.tool_calls)) {
        for (const tc of msg.tool_calls) {
          const fn = tc.function || tc;
          let args = fn.arguments;
          if (typeof args === 'string') {
            try { args = JSON.parse(args); } catch { args = {}; }
          }
          toolCalls.push({
            id: tc.id || `call_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
            name: fn.name,
            arguments: args || {}
          });
        }
      }

      // Check if the model emitted a tool call inside msg.content
      if (toolCalls.length === 0 && msg?.content) {
        try {
          const jsonMatch = msg.content.match(/\{[\s\S]*"(?:name|function)"\s*:\s*"([^"]+)"[\s\S]*\}/);
          if (jsonMatch) {
            const parsed = JSON.parse(jsonMatch[0]);
            const fnName = parsed.name || parsed.function?.name;
            const rawArgs = parsed.arguments || parsed.parameters?.properties || parsed.parameters || {};
            const resolvedArgs: Record<string, any> = {};
            if (typeof rawArgs === 'object' && rawArgs !== null) {
              for (const [k, v] of Object.entries(rawArgs)) {
                resolvedArgs[k] = typeof v === 'object' && v !== null && 'value' in v ? (v as any).value : v;
              }
            }
            if (fnName && tools.some(t => t.name === fnName)) {
              toolCalls.push({
                id: `call_${Date.now()}`,
                name: fnName,
                arguments: resolvedArgs
              });
            }
          }
        } catch {
          // ignore
        }
      }

      return {
        content: msg?.content || '',
        toolCalls: toolCalls.length > 0 ? toolCalls : undefined
      };
    } catch (err: any) {
      console.warn('Ollama generateResponse notice:', err?.response?.data || err?.message);
      throw new Error(`Ollama request failed: ${err?.response?.data?.error || err.message}`);
    }
  }
}
