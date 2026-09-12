import { AgentMessage, ToolDefinition, AgentConfig, ProviderResponse } from '../types';

export interface IAIProvider {
  /**
   * Unique name of this provider (e.g. 'ollama', 'local_openai', 'local_fallback')
   */
  getName(): string;

  /**
   * Checks if this provider is currently available and responsive.
   */
  isAvailable(): Promise<boolean>;

  /**
   * Generates a response from the provider, supporting tool calls.
   */
  generateResponse(
    messages: AgentMessage[],
    tools: ToolDefinition[],
    config: AgentConfig
  ): Promise<ProviderResponse>;

  /**
   * Gets information about available models in this provider.
   */
  getModelInfo(): Promise<{ name: string; available: boolean; details?: string }>;
}
