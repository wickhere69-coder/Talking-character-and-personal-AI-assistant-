import {
  AgentMessage,
  AgentConfig,
  AgentChatResponse,
  PendingConfirmation,
  ToolDefinition
} from './types';
import { ProviderManager } from './providers/ProviderManager';
import { ToolRegistry } from './tools/ToolRegistry';
import { registerFilesystemTools } from './tools/filesystemTools';
import { registerOsTools } from './tools/osTools';
import { registerDevTools } from './tools/devTools';
import { registerProductivityTools } from './tools/productivityTools';
import { registerDocumentTools } from './tools/documentTools';
import { registerWebTools } from './tools/webTools';
import { registerWeatherTools } from './tools/weatherTools';
import { MemoryStore } from './memory/MemoryStore';
import { ContextManager } from './memory/ContextManager';
import { PermissionManager } from './permissions/PermissionManager';

function selectRelevantTools(userMessage: string, allTools: ToolDefinition[], providerName?: string): ToolDefinition[] {
  // Groq and Gemini cloud models have large context windows and native function calling
  if (providerName === 'groq' || providerName === 'gemini') {
    return allTools;
  }

  const lower = userMessage.toLowerCase();

  const fileKeywords = ['file', 'files', 'folder', 'directory', 'dir', 'package.json', 'readme', 'read', 'write', 'create file', 'delete file', 'search code', 'project', 'code'];
  const sysKeywords = ['system', 'cpu', 'ram', 'memory', 'resource', 'specs', 'calc', 'calculator', 'notepad', 'open app', 'run command', 'terminal'];
  const taskKeywords = ['task', 'tasks', 'todo', 'to-do', 'note', 'notes', 'reminder', 'remind'];
  const memoryKeywords = ['remember', 'recall', 'favorite', 'my name', 'what did i tell', 'preference'];
  const weatherKeywords = ['weather', 'forecast', 'temperature', 'rain', 'snow', 'wind', 'sunny', 'cloudy', 'humidity', 'predict', 'storm', 'celsius', 'fahrenheit', 'hot', 'cold', 'umbrella', 'climate'];
  const webKeywords = [
    'search', 'browse', 'lookup', 'google', 'fetch', 'http', 'who', 'what', 'when',
    'where', 'why', 'how', 'is', 'are', 'was', 'news', 'current', 'latest', 'today',
    'president', 'score', 'update', 'price', 'release', 'year', 'tell me about', 'know about'
  ];

  const matchedTools = new Set<string>();

  if (fileKeywords.some(kw => lower.includes(kw))) {
    ['list_files', 'read_file', 'search_files', 'create_file', 'read_document', 'open_folder'].forEach(t => matchedTools.add(t));
  }
  if (sysKeywords.some(kw => lower.includes(kw))) {
    ['check_resources', 'get_system_info', 'open_application', 'run_command'].forEach(t => matchedTools.add(t));
  }
  if (taskKeywords.some(kw => lower.includes(kw))) {
    ['add_task', 'list_tasks', 'complete_task', 'add_note', 'list_notes', 'delete_note'].forEach(t => matchedTools.add(t));
  }
  if (memoryKeywords.some(kw => lower.includes(kw))) {
    ['remember_info', 'recall_info'].forEach(t => matchedTools.add(t));
  }
  if (weatherKeywords.some(kw => lower.includes(kw))) {
    ['predict_weather', 'get_weather'].forEach(t => matchedTools.add(t));
  }
  if (webKeywords.some(kw => lower.includes(kw))) {
    ['web_search', 'fetch_webpage'].forEach(t => matchedTools.add(t));
  }

  // Always include web_search, weather prediction, and memory as baseline tools for intelligent agents
  matchedTools.add('predict_weather');
  matchedTools.add('web_search');
  matchedTools.add('remember_info');
  matchedTools.add('recall_info');

  return allTools.filter(t => matchedTools.has(t.name));
}

export class AgentCore {
  private providerManager: ProviderManager;
  private toolRegistry: ToolRegistry;
  private memoryStore: MemoryStore;
  private contextManager: ContextManager;
  private permissionManager: PermissionManager;
  private conversationHistory: AgentMessage[] = [];

  constructor() {
    this.memoryStore = new MemoryStore();
    this.contextManager = new ContextManager(this.memoryStore);
    this.toolRegistry = new ToolRegistry();
    this.permissionManager = new PermissionManager(this.toolRegistry);

    // Register all tool suites
    registerFilesystemTools(this.toolRegistry);
    registerOsTools(this.toolRegistry);
    registerDevTools(this.toolRegistry);
    registerProductivityTools(this.toolRegistry, this.memoryStore);
    registerDocumentTools(this.toolRegistry);
    registerWebTools(this.toolRegistry);
    registerWeatherTools(this.toolRegistry);

    this.providerManager = new ProviderManager();
  }

  getToolRegistry(): ToolRegistry {
    return this.toolRegistry;
  }

  getMemoryStore(): MemoryStore {
    return this.memoryStore;
  }

  getProviderManager(): ProviderManager {
    return this.providerManager;
  }

  getPermissionManager(): PermissionManager {
    return this.permissionManager;
  }

  getConversationHistory(): AgentMessage[] {
    return this.conversationHistory;
  }

  async handleUserMessage(
    userMessage: string,
    config: AgentConfig = {}
  ): Promise<AgentChatResponse> {
    const isChatMode = config.mode === 'chat';
    const maxIterations = isChatMode ? 1 : (config.maxToolIterations || 2);
    if (isChatMode) {
      config.toolsEnabled = false;
    }
    const toolsExecuted: AgentChatResponse['toolsExecuted'] = [];
    const memoriesRecalled = this.memoryStore.recall(userMessage).map((m) => `${m.key}: ${m.value}`);

    // Build message list with system prompt and history
    const messages = this.contextManager.buildPromptMessages(
      userMessage,
      this.conversationHistory,
      config
    );

    let iteration = 0;
    let finalContent = '';
    let pendingConfirmation: PendingConfirmation | null = null;
    let lastProviderUsed = 'unknown';

    while (iteration < maxIterations) {
      iteration++;

      // Dynamically select only the tools relevant to the prompt (drops 2,500+ schema tokens down to 0-150 tokens)
      const allDefs = this.toolRegistry.getAllDefinitions();
      const toolDefs = (config.toolsEnabled === false || isChatMode)
        ? []
        : selectRelevantTools(userMessage, allDefs, config.modelProvider);

      const { response: providerRes, providerUsed } = await this.providerManager.generateResponse(
        messages,
        toolDefs,
        config
      );
      lastProviderUsed = providerUsed;

      // Check if provider requested tool calls
      if (providerRes.toolCalls && providerRes.toolCalls.length > 0) {
        for (const tc of providerRes.toolCalls) {
          const toolDef = this.toolRegistry.getTool(tc.name)?.definition;

          // Check if action is destructive and requires user confirmation
          if (toolDef && this.permissionManager.requiresConfirmation(toolDef)) {
            pendingConfirmation = this.permissionManager.createPendingConfirmation(tc.name, tc.arguments);
            return {
              response: `This action requires your confirmation: ${toolDef.description}. Would you like me to proceed with ${tc.name}?`,
              status: 'awaiting_confirmation',
              pendingConfirmation,
              modelUsed: lastProviderUsed,
              memoriesRecalled
            };
          }

          // Execute tool safely
          const result = await this.toolRegistry.execute(tc.name, tc.arguments);
          toolsExecuted.push({
            name: tc.name,
            parameters: tc.arguments,
            result
          });

          // Append tool execution message to the message chain
          messages.push({
            role: 'assistant',
            content: providerRes.content || '',
            toolCalls: [tc]
          });

          messages.push({
            role: 'tool',
            content: JSON.stringify(result.data || result.message),
            toolCallId: tc.id,
            toolResult: result
          });
        }

        // Fast path: Only local_fallback or explicit chat mode returns tool message directly
        if (providerUsed === 'local_fallback' || isChatMode) {
          const weatherTool = toolsExecuted.find(t => t.name === 'predict_weather' || t.name === 'get_weather');
          const webSearchTool = toolsExecuted.find(t => t.name === 'web_search');
          if (weatherTool && weatherTool.result.message) {
            finalContent = weatherTool.result.message;
          } else if (webSearchTool && Array.isArray(webSearchTool.result.data) && webSearchTool.result.data.length > 0) {
            finalContent = `According to the latest information: ${webSearchTool.result.data.slice(0, 2).join(' ')}`;
          } else {
            finalContent = toolsExecuted.map((t) => t.result.message).join(' ');
          }
          break;
        }

        // For neural models (Groq, Gemini, Ollama): allow next iteration so the LLM reads
        // the tool execution results and synthesizes a natural, concise, up-to-date answer!
        if (iteration >= maxIterations) {
          const weatherTool = toolsExecuted.find(t => t.name === 'predict_weather' || t.name === 'get_weather');
          const webSearchTool = toolsExecuted.find(t => t.name === 'web_search');
          if (weatherTool && weatherTool.result.message) {
            finalContent = weatherTool.result.message;
          } else if (webSearchTool && Array.isArray(webSearchTool.result.data) && webSearchTool.result.data.length > 0) {
            finalContent = `Based on current live search results: ${webSearchTool.result.data.slice(0, 2).join(' ')}`;
          } else {
            finalContent = toolsExecuted.map((t) => t.result.message).join(' ');
          }
          break;
        }
      } else {
        // No tool calls needed; final spoken response generated
        finalContent = providerRes.content;
        break;
      }
    }

    if (!finalContent) {
      if (toolsExecuted.length > 0) {
        const weatherTool = toolsExecuted.find(t => t.name === 'predict_weather' || t.name === 'get_weather');
        const webSearchTool = toolsExecuted.find(t => t.name === 'web_search');
        if (weatherTool && weatherTool.result.message) {
          finalContent = weatherTool.result.message;
        } else if (webSearchTool && Array.isArray(webSearchTool.result.data) && webSearchTool.result.data.length > 0) {
          finalContent = `According to the latest information: ${webSearchTool.result.data.slice(0, 2).join(' ')}`;
        } else {
          finalContent = toolsExecuted.map((t) => t.result.message).join(' ');
        }
      } else {
        finalContent = "I've processed your message. How can I assist you further?";
      }
    }

    // Update conversation history
    this.conversationHistory.push({ role: 'user', content: userMessage });
    this.conversationHistory.push({ role: 'assistant', content: finalContent });
    if (this.conversationHistory.length > 20) {
      this.conversationHistory = this.conversationHistory.slice(-20);
    }

    this.contextManager.saveTurn(userMessage, finalContent);

    return {
      response: finalContent,
      status: 'speaking',
      toolsExecuted,
      modelUsed: lastProviderUsed,
      memoriesRecalled
    };
  }

  async resolveConfirmation(
    confirmationId: string,
    approved: boolean
  ): Promise<AgentChatResponse> {
    const res = await this.permissionManager.resolveConfirmation(confirmationId, approved);
    const spokenResponse = approved
      ? `Action confirmed and executed. ${res.message}`
      : `Action was cancelled as requested.`;

    this.conversationHistory.push({ role: 'assistant', content: spokenResponse });

    return {
      response: spokenResponse,
      status: 'speaking',
      modelUsed: 'local_permissions',
      toolsExecuted: res.toolResult ? [{ name: 'confirmed_action', parameters: {}, result: res.toolResult }] : undefined
    };
  }

  clearContext(): void {
    this.conversationHistory = [];
    this.memoryStore.clearHistory();
  }
}
