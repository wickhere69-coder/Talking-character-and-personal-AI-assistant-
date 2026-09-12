import { IAIProvider } from './IAIProvider';
import { GroqProvider } from './GroqProvider';
import { GeminiProvider } from './GeminiProvider';
import { OllamaProvider } from './OllamaProvider';
import { LocalModelProvider } from './LocalModelProvider';
import { FallbackLocalProvider } from './FallbackLocalProvider';
import { AgentConfig, AgentMessage, ToolDefinition, ProviderResponse } from '../types';

export class ProviderManager {
  private providers: Map<string, IAIProvider> = new Map();
  private defaultProviderName: string;

  constructor(defaultProviderName = process.env.MODEL_PROVIDER || 'local_fallback') {
    this.defaultProviderName = defaultProviderName;

    // Register supported providers
    this.registerProvider(new GroqProvider());
    this.registerProvider(new GeminiProvider());
    this.registerProvider(new OllamaProvider());
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
   * Resolves the active provider. If 'auto' or chosen provider unavailable,
   * cascades: Groq -> Gemini -> Ollama -> Local OpenAI -> Local Fallback.
   */
  async getActiveProvider(overrideName?: string): Promise<IAIProvider> {
    const target = overrideName || this.defaultProviderName;

    if (target !== 'auto' && this.providers.has(target)) {
      const explicit = this.providers.get(target)!;
      if (await explicit.isAvailable()) {
        return explicit;
      }
    }

    // Auto detection cascade:
    // 1. Check Groq (cloud ultra-fast)
    const groq = this.providers.get('groq');
    if (groq && (await groq.isAvailable())) {
      return groq;
    }

    // 2. Check Gemini (Google cloud fast)
    const gemini = this.providers.get('gemini');
    if (gemini && (await gemini.isAvailable())) {
      return gemini;
    }

    // 3. Check Ollama (local neural)
    const ollama = this.providers.get('ollama');
    if (ollama && (await ollama.isAvailable())) {
      return ollama;
    }

    // 4. Check Local OpenAI endpoint
    const localOpenai = this.providers.get('local_openai');
    if (localOpenai && (await localOpenai.isAvailable())) {
      return localOpenai;
    }

    // 5. Guaranteed offline fallback
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
    try {
      const response = await provider.generateResponse(messages, tools, config);
      return {
        response,
        providerUsed: provider.getName()
      };
    } catch (err: any) {
      console.warn(`Provider ${provider.getName()} failed, falling back to local offline provider:`, err.message);
      const fallback = this.providers.get('local_fallback');
      if (fallback && provider.getName() !== 'local_fallback') {
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
