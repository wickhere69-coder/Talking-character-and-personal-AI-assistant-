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
    baseUrl = 'https://generativelanguage.googleapis.com/v1beta',
    defaultModel = process.env.GEMINI_MODEL || 'models/gemini-3.5-flash-lite'
  ) {
    this.apiKey = apiKey.trim();
    this.baseUrl = baseUrl.replace(/\/$/, '').replace(/\/openai$/, '');
    this.defaultModel = defaultModel.replace(/^models\//, '');
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
    
    const now = Date.now();
    if (this.cachedAvailable !== null && now < this.cacheExpiry) {
      return this.cachedAvailable;
    }

    try {
      const res = await axios.get(`${this.baseUrl}/models?key=${key}`, {
        timeout: 4000
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
      const res = await axios.get(`${this.baseUrl}/models?key=${key}`, {
        timeout: 4000
      });
      const rawModels = (res.data?.models || []).map((m: any) => m.name.replace(/^models\//, ''));
      const chosen = rawModels.includes(this.defaultModel) ? this.defaultModel : 'gemini-3.5-flash-lite';

      return {
        name: chosen,
        available: true,
        details: `Google Gemini Cloud: ${chosen} (High-intelligence, low-latency conversational engine)`
      };
    } catch (err: any) {
      return {
        name: this.defaultModel,
        available: false,
        details: `Gemini API error: ${err.response?.data?.error?.message || err.message}`
      };
    }
  }

  private getCandidateModels(requestedModel?: string): string[] {
    const candidates = [
      (requestedModel || '').replace(/^models\//, ''),
      'gemini-flash-lite-latest',
      'gemini-3.5-flash',
      'gemini-3.5-flash-lite',
      'gemini-3.8-flash',
      'gemini-3.1-flash-lite'
    ].filter(Boolean);
    return Array.from(new Set(candidates));
  }

  async generateResponse(
    messages: AgentMessage[],
    tools: ToolDefinition[],
    config: AgentConfig
  ): Promise<ProviderResponse> {
    const key = this.getApiKey();
    if (!key) {
      throw new Error('Google Gemini API Key is required. Please set GEMINI_API_KEY in .env or Control Panel.');
    }

    // Format tools for native Gemini functionDeclarations
    const toolsConfig: any = {};
    if (tools.length > 0 && config.toolsEnabled !== false) {
      const functionDeclarations = tools.map((t) => {
        const properties: Record<string, any> = {};
        const required: string[] = [];

        for (const [propKey, prop] of Object.entries(t.parameters)) {
          properties[propKey] = {
            type: (prop.type || 'string').toUpperCase(),
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
          name: t.name,
          description: t.description,
          parameters: {
            type: 'OBJECT',
            properties,
            required
          }
        };
      });

      toolsConfig.tools = [{ functionDeclarations }];
    }

    // Extract system instructions and format user/assistant contents
    const systemParts: string[] = [];
    const contents: any[] = [];

    for (const m of messages) {
      if (m.role === 'system') {
        if (m.content) systemParts.push(m.content);
      } else if (m.role === 'tool') {
        contents.push({
          role: 'user',
          parts: [{ text: `[Information Retrieved from Tool]:\n${m.content || ''}\n\nPlease synthesize this into a clear, direct, and complete spoken answer.` }]
        });
      } else if (m.role === 'assistant') {
        contents.push({
          role: 'model',
          parts: [{ text: m.content || '' }]
        });
      } else {
        contents.push({
          role: 'user',
          parts: [{ text: m.content || '' }]
        });
      }
    }

    if (contents.length === 0) {
      contents.push({ role: 'user', parts: [{ text: 'Hello' }] });
    }

    const payload: any = {
      contents,
      generationConfig: {
        temperature: config.temperature ?? 0.7,
        maxOutputTokens: config.maxTokens || 2048
      },
      ...toolsConfig
    };

    if (systemParts.length > 0) {
      payload.systemInstruction = {
        parts: [{ text: systemParts.join('\n\n') }]
      };
    }

    const candidateModels = this.getCandidateModels(config.modelName);
    let lastError: any = null;

    for (const candidate of candidateModels) {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${candidate}:generateContent?key=${key}`;
      try {
        const res = await axios.post(url, payload, {
          headers: { 'Content-Type': 'application/json' },
          timeout: 20000
        });

        const candidateChoice = res.data?.candidates?.[0];
        const parts = candidateChoice?.content?.parts || [];

        let content = '';
        const toolCalls: Array<{ id: string; name: string; arguments: Record<string, any> }> = [];

        for (const part of parts) {
          if (part.text) {
            content += part.text;
          }
          if (part.functionCall) {
            toolCalls.push({
              id: `call_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
              name: part.functionCall.name,
              arguments: part.functionCall.args || {}
            });
          }
        }

        if (content || toolCalls.length > 0) {
          this.defaultModel = candidate;
          return {
            content,
            toolCalls: toolCalls.length > 0 ? toolCalls : undefined
          };
        }
      } catch (err: any) {
        lastError = err;
        const msg = err.response?.data?.error?.message || err.message;
        console.warn(`[GEMINI PROVIDER] Candidate ${candidate} attempt notice (${msg}), trying next available model...`);
        continue;
      }
    }

    throw lastError || new Error('All Gemini candidate models were unavailable.');
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
      const res = await this.generateResponse(messages, tools, config);
      if (res.content) {
        onChunk(res.content);
      }
      return res;
    }

    const key = this.getApiKey();
    if (!key) {
      throw new Error('Google Gemini API Key is required.');
    }

    const isConversational = config.mode === 'conversational' || config.mode === 'chat';
    const streamTimeout = 30000;
    const maxTokens = Math.max(config.maxTokens || 0, isConversational ? 1024 : 2048);

    const explicitSystem = messages.find((m) => m.role === 'system')?.content || '';
    const voiceDirective = isConversational
      ? `You are Aura, an articulate, witty, and knowledgeable AI companion.
1. Adaptive Answering Effort & Length:
- For small, simple, or straightforward questions (such as greetings, basic arithmetic like 2+2, single-fact queries, yes/no, definitions, or quick checks): Give a direct, punchy, one-sentence answer (or two short sentences at most) with zero filler. Never give lengthy answers or unsolicited exposition to small questions.
- For medium questions: Provide two to three concise, articulate spoken sentences.
- For complex, analytical, or deep reasoning questions: Scale up your reasoning effort and depth accordingly, providing a thorough, structured, and insightful multi-sentence explanation.
2. Automatic Sentence & Typo Auto-Correction:
- Users interact via voice speech-to-text, which frequently introduces phonetic mishearings, garbled words, spelling errors, or missing punctuation (e.g., 'wether in pares' -> 'weather in Paris', 'whats 10 pul 20' -> 'what is 10 plus 20', 'supper bowl' -> 'Super Bowl').
- Automatically infer the user's true intended question, silently correct the sentence in your mind, and answer the intended question directly and accurately. Never lecture the user about errors.
3. Pure Spoken Cadence:
- Never output markdown asterisks, hashtags, or bullet lists in your response. Speak in natural, flowing conversational English.`
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

    const candidateModels = this.getCandidateModels(config.modelName);

    for (const candidateModel of candidateModels) {
      const innerAbort = new AbortController();
      const abortRelay = () => innerAbort.abort();
      if (signal) {
        signal.addEventListener('abort', abortRelay);
      }

      try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${candidateModel}:streamGenerateContent?alt=sse&key=${key}`;
        const generationConfig: any = {
          temperature: config.temperature ?? 0.7,
          maxOutputTokens: maxTokens
        };
        const payload: any = {
          contents,
          generationConfig
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
              reject(new Error(`Native Gemini first token timeout (>6s) for ${candidateModel}`));
            }
          }, 6000);

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
          this.defaultModel = candidateModel;
          if (signal) signal.removeEventListener('abort', abortRelay);
          return streamResult;
        }
      } catch (err: any) {
        if (signal) signal.removeEventListener('abort', abortRelay);
        if (signal?.aborted) throw err;
        console.warn(`[GEMINI NATIVE STREAM] Candidate ${candidateModel} notice:`, err?.message || err);
        continue;
      }
    }

    // If stream failed across all models, fallback to standard generateResponse
    const fallback = await this.generateResponse(messages, tools, config);
    if (fallback.content) {
      onChunk(fallback.content);
    }
    return fallback;
  }
}
