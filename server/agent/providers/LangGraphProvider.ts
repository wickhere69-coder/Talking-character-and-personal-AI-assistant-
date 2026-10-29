import { IAIProvider } from './IAIProvider';
import { AgentMessage, ToolDefinition, AgentConfig, ProviderResponse } from '../types';
import { LangGraphOrchestrator } from '../langgraph/LangGraphOrchestrator';

/**
 * LangGraphProvider — wires the full multi-node graph orchestrator
 * into the standard IAIProvider interface.
 * 
 * Graph: classify → routeModel → think → [tools] → synthesize → reflect
 */
export class LangGraphProvider implements IAIProvider {
  private orchestrator: LangGraphOrchestrator;

  constructor() {
    this.orchestrator = new LangGraphOrchestrator();
  }

  getName(): string {
    return 'langgraph';
  }

  async isAvailable(): Promise<boolean> {
    const key = process.env.GEMINI_API_KEY?.trim();
    return !!key;
  }

  async getModelInfo(): Promise<{ name: string; available: boolean; details?: string }> {
    const key = process.env.GEMINI_API_KEY?.trim();
    return {
      name: 'LangGraph Multi-Node Agent',
      available: !!key,
      details: key
        ? 'Graph: Classify → Route → Think → Tools → Synthesize → Reflect'
        : 'Requires GEMINI_API_KEY'
    };
  }

  async generateResponse(
    messages: AgentMessage[],
    tools: ToolDefinition[],
    config: AgentConfig
  ): Promise<ProviderResponse> {
    const key = process.env.GEMINI_API_KEY?.trim();
    if (!key) throw new Error('GEMINI_API_KEY required for LangGraph provider');

    const lastUser = [...messages].reverse().find(m => m.role === 'user');
    if (!lastUser) return { content: "I didn't catch that. Could you say it again?" };

    const systemPrompt = messages.find(m => m.role === 'system')?.content || '';
    const history = messages.filter(m => m.role !== 'system' && m.role !== 'tool');

    const result = await this.orchestrator.run(
      lastUser.content,
      systemPrompt,
      history,
      tools,
      config,
      async (_name, _args) => ({ success: false, message: 'Tool not available in this context' })
    );

    return { content: result.response };
  }

  async generateResponseStream(
    messages: AgentMessage[],
    tools: ToolDefinition[],
    config: AgentConfig,
    onChunk: (delta: string) => void,
    _signal?: AbortSignal
  ): Promise<ProviderResponse> {
    // Graph runs synchronously then delivers — simulate streaming by chunking output
    const response = await this.generateResponse(messages, tools, config);
    if (response.content) {
      // Deliver in sentence-sized chunks for natural feel
      const sentences = response.content.match(/[^.!?]+[.!?]+/g) || [response.content];
      for (const sentence of sentences) {
        onChunk(sentence.trim() + ' ');
        await new Promise(r => setTimeout(r, 10));
      }
    }
    return response;
  }
}
