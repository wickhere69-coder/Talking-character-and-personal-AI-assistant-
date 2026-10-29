import { IAIProvider } from './IAIProvider';
import { GrokProvider } from './GrokProvider';
import { GeminiProvider } from './GeminiProvider';
import { LangGraphProvider } from './LangGraphProvider';
import { LocalModelProvider } from './LocalModelProvider';
import { FallbackLocalProvider } from './FallbackLocalProvider';
import { AgentConfig, AgentMessage, ToolDefinition, ProviderResponse } from '../types';

export class ProviderManager {
  private providers: Map<string, IAIProvider> = new Map();
  private defaultProviderName: string;

  constructor(defaultProviderName = process.env.MODEL_PROVIDER || 'auto') {
    this.defaultProviderName = defaultProviderName;

    // Register supported providers
    this.registerProvider(new GeminiProvider());
    this.registerProvider(new GrokProvider());
    this.registerProvider(new LangGraphProvider());
    this.registerProvider(new LocalModelProvider());
    this.registerProvider(new FallbackLocalProvider());
  }

  registerProvider(provider: IAIProvider): void {
    this.providers.set(provider.getName(), provider);
  }

  getProvider(name: string): IAIProvider | undefined {
    return this.providers.get(name);
  }

  setProviderKey(providerName: string, key: string): void {
    const provider = this.providers.get(providerName);
    if (provider && 'setApiKey' in provider && typeof (provider as any).setApiKey === 'function') {
      (provider as any).setApiKey(key);
    }
  }

  /**
   * Resolves the active provider dynamically based on query requirements:
   * - Deep Reasoning / Math / Logic / Coding queries -> LangGraph Multi-Node Engine
   * - Speed Dialogue / Conversational queries -> Gemini Flash-Lite Low-Latency Engine
   * - Explicit overrides from Admin Panel are always strictly honored.
   */
  async getActiveProvider(overrideName?: string, userMessage?: string): Promise<IAIProvider> {
    const target = overrideName || this.defaultProviderName;

    // Instant / local fallback
    if (target === 'instant' || target === 'local_fallback') {
      return this.providers.get('local_fallback')!;
    }

    // Dynamic AI Model Auto-Switching:
    // Route complex math, logic, algorithms, and deep analysis to LangGraph Multi-Step Reasoning
    const isReasoning = userMessage ? this.isComplexReasoningQuery(userMessage) : false;
    const geminiKey = process.env.GEMINI_API_KEY?.trim();

    if (geminiKey) {
      // If query is complex reasoning, or explicitly requested langgraph, route to LangGraph
      if (target === 'langgraph') {
        const langgraph = this.providers.get('langgraph');
        if (langgraph) return langgraph;
      }

      // If explicit other provider requested (e.g. grok)
      if (target !== 'auto' && target !== 'gemini' && this.providers.has(target)) {
        const explicit = this.providers.get(target)!;
        return explicit;
      }

      const gemini = this.providers.get('gemini');
      if (gemini) return gemini;
    }

    // Explicit provider requested (Admin Console selection)
    if (target !== 'auto' && this.providers.has(target)) {
      const explicit = this.providers.get(target)!;
      return explicit;
    }

    // Fallback to local
    return this.providers.get('local_fallback')!;
  }

  private isComplexReasoningQuery(msg: string): boolean {
    const lower = msg.toLowerCase().trim();
    const mathPatterns = [/\d+\s*[\+\-\*\/]\s*\d+/, /equation/, /calculate/, /integral/, /derivative/, /algebra/, /geometry/, /percentage/];
    const reasoningKeywords = [
      'solve', 'prove', 'step by step', 'logic', 'paradox', 'bat and a ball',
      'machines take', 'train leaves', 'how many', 'explain why', 'difference between',
      'algorithm', 'time complexity', 'optimize', 'critique', 'deep analysis',
      'philosophical', 'suppose that', 'assume that', 'riddle', 'puzzle', 'why does'
    ];

    if (mathPatterns.some(p => p.test(lower))) return true;
    if (reasoningKeywords.some(k => lower.includes(k))) return true;
    if (lower.split(/\s+/).length > 20 && lower.includes('?')) return true;
    return false;
  }

  async getHealth(): Promise<{
    activeProvider: string;
    modelInfo: { name: string; available: boolean; details?: string };
    availableProviders: Array<{ name: string; available: boolean }>;
  }> {
    const active = await this.getActiveProvider();
    const modelInfo = await active.getModelInfo();

    const availableProviders = await Promise.all(
      Array.from(this.providers.entries()).map(async ([name, provider]) => {
        try {
          const timeoutPromise = new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 1500));
          const available = await Promise.race([provider.isAvailable(), timeoutPromise]);
          return { name, available };
        } catch {
          return { name, available: false };
        }
      })
    );

    return {
      activeProvider: active.getName(),
      modelInfo,
      availableProviders
    };
  }

  async generateResponse(
    messages: AgentMessage[],
    tools: ToolDefinition[],
    config: AgentConfig
  ): Promise<{ response: ProviderResponse; providerUsed: string }> {
    const userMessage = [...messages].reverse().find(m => m.role === 'user')?.content || '';
    const provider = await this.getActiveProvider(config.modelProvider, userMessage);

    if (provider.getName() === 'local_fallback') {
      const response = await provider.generateResponse(messages, tools, config);
      return { response, providerUsed: 'local_fallback' };
    }

    try {
      const isMultiStep = provider.getName() === 'langgraph';
      const timeoutMs = isMultiStep ? 30000 : 25000;
      let timeoutId: ReturnType<typeof setTimeout>;
      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error(`Timeout: ${provider.getName()} exceeded ${timeoutMs / 1000}s limit`)), timeoutMs);
      });

      const response = await Promise.race([
        provider.generateResponse(messages, tools, config).then((r) => { clearTimeout(timeoutId); return r; }),
        timeoutPromise
      ]);

      const label = provider.getName() === 'langgraph' 
        ? 'LangGraph (Deep Reasoning Engine)' 
        : (provider.getName() === 'gemini' ? 'Google Gemini Flash-Lite' : provider.getName());

      return {
        response,
        providerUsed: label
      };
    } catch (err: any) {
      console.warn(`[PROVIDER SPEED GUARD] Provider ${provider.getName()} notice (${err.message}), falling back to local.`);
      const fallback = this.providers.get('local_fallback');
      if (fallback) {
        const response = await fallback.generateResponse(messages, tools, config);
        return {
          response,
          providerUsed: 'local_fallback'
        };
      }
      throw err;
    }
  }

  async generateResponseStream(
    messages: AgentMessage[],
    tools: ToolDefinition[],
    config: AgentConfig,
    onChunk: (delta: string) => void,
    signal?: AbortSignal
  ): Promise<{ response: ProviderResponse; providerUsed: string }> {
    const userMessage = [...messages].reverse().find(m => m.role === 'user')?.content || '';
    const provider = await this.getActiveProvider(config.modelProvider, userMessage);

    if (provider.getName() === 'local_fallback' || typeof (provider as any).generateResponseStream !== 'function') {
      const response = await provider.generateResponse(messages, tools, config);
      if (response.content) {
        onChunk(response.content);
      }
      return { response, providerUsed: provider.getName() };
    }

    try {
      const streamProvider = provider as any;
      const response = await streamProvider.generateResponseStream(
        messages,
        tools,
        config,
        onChunk,
        signal
      );
      if (!response || !response.content || !response.content.trim()) {
        throw new Error(`${provider.getName()} stream yielded empty response`);
      }

      const label = provider.getName() === 'langgraph' 
        ? 'LangGraph (Deep Reasoning Engine)' 
        : (provider.getName() === 'gemini' ? 'Google Gemini Flash-Lite' : provider.getName());

      return {
        response,
        providerUsed: label
      };
    } catch (err: any) {
      if (signal?.aborted) {
        return { response: { content: '' }, providerUsed: provider.getName() };
      }
      console.warn(`[PROVIDER STREAM NOTICE] Provider ${provider.getName()} stream notice (${err.message}), falling back to local.`);
      
      const fallback = this.providers.get('local_fallback');
      if (fallback) {
        const response = await fallback.generateResponse(messages, tools, config);
        if (response.content) {
          onChunk(response.content);
        }
        return { response, providerUsed: 'local_fallback' };
      }
      throw err;
    }
  }
}

