import { IAIProvider } from './IAIProvider';
import { AgentMessage, ToolDefinition, AgentConfig, ProviderResponse, ToolResult } from '../types';
import { LangGraphOrchestrator } from '../langgraph/LangGraphOrchestrator';
import { ToolRegistry } from '../tools/ToolRegistry';
import { PermissionManager } from '../permissions/PermissionManager';

/**
 * LangGraphProvider — wires the full multi-node graph orchestrator
 * into the standard IAIProvider interface.
 * 
 * Graph: classify → routeModel → think → [tools] → synthesize → reflect
 */
export class LangGraphProvider implements IAIProvider {
  private orchestrator: LangGraphOrchestrator;
  private toolRegistry?: ToolRegistry;
  private permissionManager?: PermissionManager;

  constructor(toolRegistry?: ToolRegistry, permissionManager?: PermissionManager) {
    this.orchestrator = new LangGraphOrchestrator();
    this.toolRegistry = toolRegistry;
    this.permissionManager = permissionManager;
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
      async (name: string, args: Record<string, any>): Promise<ToolResult> => {
        // Architectural Decision - No Double Execution:
        // LangGraphProvider executes tools internally within its graph orchestrator loop
        // and synthesizes the results directly into the final spoken content response.
        // It returns { content } with NO toolCalls so that AgentCore does not re-execute the same tools.

        if (!this.toolRegistry) {
          return { success: false, message: 'Tool registry not available in this context' };
        }

        // 1. Tool name MUST be in the tools[] list passed to generateResponse()
        const isAllowed = tools.some(t => t.name === name);
        if (!isAllowed) {
          return { success: false, message: `Tool not allowed for this request: ${name}` };
        }

        // 2. Look up the tool definition. If it does not exist, return the registry's unknown-tool failure
        const toolHandler = this.toolRegistry.getTool(name);
        if (!toolHandler) {
          return await this.toolRegistry.execute(name, args);
        }
        const definition = toolHandler.definition;

        // 3. If PermissionManager.requiresConfirmation(definition) is true, DO NOT EXECUTE IT
        const needsConfirmation = this.permissionManager
          ? this.permissionManager.requiresConfirmation(definition)
          : (definition.permission === 'DESTRUCTIVE' || definition.permission === 'SYSTEM');

        if (needsConfirmation) {
          return { success: false, message: `Tool ${name} requires user confirmation and was not executed.` };
        }

        // 4. Otherwise, execute it via the registry and return its real result, success or failure, unchanged
        return await this.toolRegistry.execute(name, args);
      }
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
