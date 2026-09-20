import { IAIProvider } from './IAIProvider';
import { GrokProvider } from './GrokProvider';
import { GeminiProvider } from './GeminiProvider';
import { LocalModelProvider } from './LocalModelProvider';
import { FallbackLocalProvider } from './FallbackLocalProvider';
import { AgentConfig, AgentMessage, ToolDefinition, ProviderResponse } from '../types';

export class ProviderManager {
  private providers: Map<string, IAIProvider> = new Map();
  private defaultProviderName: string;

  constructor(defaultProviderName = process.env.MODEL_PROVIDER || 'grok') {
    this.defaultProviderName = defaultProviderName;

    // Register supported providers
    this.registerProvider(new GrokProvider());
    this.registerProvider(new GeminiProvider());
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
   * Resolves the active provider instantly by checking configured keys.
   * Eliminates sequential network probe timeouts on user chat requests.
   */
  async getActiveProvider(overrideName?: string): Promise<IAIProvider> {
    const target = overrideName || this.defaultProviderName;

    // Instant / local fallback
    if (target === 'instant' || target === 'local_fallback') {
      return this.providers.get('local_fallback')!;
    }

    // Explicit provider requested
    if (target !== 'auto' && this.providers.has(target)) {
      const explicit = this.providers.get(target)!;
      // Fast check: If provider requires an API key and has none, skip immediately
      if ('getApiKey' in explicit && typeof (explicit as any).getApiKey === 'function') {
        const key = (explicit as any).getApiKey();
        if (!key) {
          console.log(`[PROVIDER] ${target} has no API key configured, using fast local fallback`);
          return this.providers.get('local_fallback')!;
        }
      }
      return explicit;
    }

    // Auto resolution: pick first provider with a configured API key
    const grok = this.providers.get('grok');
    if (grok && 'getApiKey' in grok && (grok as any).getApiKey()) {
      return grok;
    }

    const gemini = this.providers.get('gemini');
    if (gemini && 'getApiKey' in gemini && (gemini as any).getApiKey()) {
      return gemini;
    }

    return this.providers.get('local_fallback')!;
  }

  async getHealth(): Promise<{
    activeProvider: string;
    modelInfo: { name: string; available: boolean; details?: string };
    availableProviders: Array<{ name: string; available: boolean }>;
  }> {
    const active = await this.getActiveProvider();
    const modelInfo = await active.getModelInfo();

    const availableProviders: Array<{ name: string; available: boolean }> = [];
    for (const [name, provider] of this.providers) {
      availableProviders.push({
        name,
        available: await provider.isAvailable()
      });
    }

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
    const provider = await this.getActiveProvider(config.modelProvider);

    if (provider.getName() === 'local_fallback') {
      const response = await provider.generateResponse(messages, tools, config);
      return { response, providerUsed: 'local_fallback' };
    }

    try {
      // Enforce strict 2.2s execution timeout so user gets answers in 1-2s guaranteed
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`Timeout: ${provider.getName()} exceeded 2.2s limit`)), 2200)
      );

      const response = await Promise.race([
        provider.generateResponse(messages, tools, config),
        timeoutPromise
      ]);

      return {
        response,
        providerUsed: provider.getName()
      };
    } catch (err: any) {
      console.warn(`[PROVIDER SPEED GUARD] Provider ${provider.getName()} notice (${err.message}), falling back to 5ms local engine.`);
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
}
