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
import { SessionManager } from './memory/SessionManager';
import { PermissionManager } from './permissions/PermissionManager';

function normalizeVoiceInput(raw: string): string {
  let text = raw || '';
  // Common phonetic voice STT corrections
  text = text.replace(/\b(wether|weathr|waether)\b/gi, 'weather');
  text = text.replace(/\b(fore\s+cast|forcast|forcasting)\b/gi, 'forecast');
  text = text.replace(/\b(temprature|temperture|tempreture)\b/gi, 'temperature');
  text = text.replace(/\b(celcius|celcious)\b/gi, 'celsius');
  text = text.replace(/\b(farenheit|fahrenhiet|fairnheit)\b/gi, 'fahrenheit');
  text = text.replace(/\b(\d+)\s+(?:pul|pluss|pls)\s+(\d+)\b/gi, '$1 plus $2');
  return text;
}

function extractWeatherLocation(userMessage: string): string | null {
  const q = userMessage.trim().replace(/[?!.,]/g, '');

  // 1. in/for/at/around/of <location>
  let match = q.match(/\b(?:in|for|at|around|of)\s+([A-Za-z\s.-]+?)(?:\s+(?:today|tomorrow|tonight|this week|now|right now|please)|$)/i);
  if (match && match[1].trim()) {
    const loc = match[1].trim();
    if (!['the', 'my area', 'here', 'outside', 'this city', 'town', 'my location'].includes(loc.toLowerCase())) {
      return loc;
    }
  }

  // 2. <location> weather / forecast / temperature
  match = q.match(/\b([A-Za-z\s.-]+?)\s+(?:weather|forecast|temperature|temp)\b/i);
  if (match && match[1].trim()) {
    const loc = match[1].trim().replace(/^(what is|whats|what's|how is|how's|hows|tell me|the|check)\s+/i, '').trim();
    if (loc && !['the', 'current', 'today', 'my', 'local', 'live', 'upcoming'].includes(loc.toLowerCase())) {
      return loc;
    }
  }

  // 3. weather/forecast in/for <location>
  match = q.match(/\b(?:weather|forecast|temperature)\s+(?:in|for|at|of)?\s*([A-Za-z\s.-]+)/i);
  if (match && match[1].trim()) {
    const loc = match[1].trim().replace(/\s+(today|tomorrow|now|right now|please)$/i, '').trim();
    if (loc && !['like', 'outside', 'today', 'tomorrow', 'now', 'right now', 'here'].includes(loc.toLowerCase())) {
      return loc;
    }
  }

  return null;
}

function selectRelevantTools(userMessage: string, allTools: ToolDefinition[], providerName?: string): ToolDefinition[] {
  const lower = userMessage.toLowerCase().trim();

  // Fast check: common greetings and direct conversation need zero tools
  const commonChat = ['hello', 'hi', 'hey', 'how are you', 'what is your name', 'who are you', 'tell me a joke', 'good morning', 'good evening', 'thank you', 'thanks', 'bye'];
  if (commonChat.some(c => lower === c || lower.startsWith(c + ' ') || lower.endsWith(' ' + c))) {
    return [];
  }

  const fileKeywords = ['file', 'files', 'folder', 'directory', 'dir', 'package.json', 'readme', 'read file', 'write file', 'create file', 'delete file', 'search code', 'inspect code'];
  // Host OS/Hardware inspection keywords - strictly restricted to hardware resources to avoid hijacking general topics
  const sysKeywords = [
    'my cpu', 'cpu usage', 'my ram', 'ram usage', 'system memory', 'memory usage',
    'my computer specs', 'pc specs', 'system specs', 'computer specs', 'hardware specs',
    'system info', 'about this pc', 'about this computer', 'host specs',
    'open calculator', 'launch calculator', 'run terminal command', 'execute command in powershell', 'run command', 'system command', 'terminal command'
  ];
  const taskKeywords = ['add task', 'list tasks', 'todo', 'to-do', 'complete task', 'add note', 'list notes', 'delete note'];
  const memoryKeywords = ['remember that', 'remember my', 'recall my', 'what did i tell you', 'my favorite'];
  const weatherKeywords = ['weather', 'wether', 'forecast', 'fore cast', 'temperature', 'temprature', 'rain', 'raining', 'snow', 'snowing', 'wind', 'sunny', 'cloudy', 'humidity', 'predict weather', 'storm', 'celsius', 'fahrenheit', 'degrees'];
  const webKeywords = [
    // Use explicit phrases instead of bare 'search' to avoid matching "search files",
    // "search notes", "search my tasks" which should route to file/task tools.
    'search online', 'search the web', 'search google', 'search for news',
    'google', 'browse', 'lookup', 'look up', 'find online',
    'latest news', 'current news', 'breaking news', 'recent news', 'today\'s news',
    'what is happening', 'what happened', 'who is', 'who won', 'current price',
    'stock price', 'latest update', 'recent events', 'current event', 'ongoing',
    'election', 'championship', 'tournament', 'world cup', 'space exploration'
  ];

  const matchedTools = new Set<string>();

  if (fileKeywords.some(kw => lower.includes(kw))) {
    ['list_files', 'read_file', 'search_files', 'create_file', 'delete_file', 'read_document', 'open_folder'].forEach(t => matchedTools.add(t));
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

  // Cloud models (Gemini, Grok) have native tool calling and should always have web_search available
  // so they can dynamically pull live web facts whenever answering current affairs or news.
  const isCloudProvider = providerName === 'auto' || providerName === 'gemini' || providerName === 'grok';
  if (isCloudProvider) {
    matchedTools.add('web_search');
    matchedTools.add('fetch_webpage');
  }

  return allTools.filter(t => matchedTools.has(t.name));
}

/**
 * Synthesizes a plain-text spoken answer from tool execution results.
 * Called when the LLM did not produce a final content string after tool calls.
 */
function synthesizeToolResults(toolsExecuted: AgentChatResponse['toolsExecuted']): string {
  if (!toolsExecuted || toolsExecuted.length === 0) {
    return "I've processed your message. How can I assist you further?";
  }
  const weatherTool = toolsExecuted.find(t => t.name === 'predict_weather' || t.name === 'get_weather');
  const webSearchTool = toolsExecuted.find(t => t.name === 'web_search');
  if (weatherTool) {
    const d = weatherTool.result?.data;
    if (d?.location && d?.current) {
      const cur = d.current;
      const forecastText = Array.isArray(d.forecast) && d.forecast.length > 0
        ? ` Today will see ${d.forecast[0].condition.toLowerCase()} with a high of ${d.forecast[0].tempMaxC} degrees Celsius and a low of ${d.forecast[0].tempMinC} degrees.`
        : '';
      return `In ${d.location}, it is currently ${cur.condition.toLowerCase()} at ${cur.temperatureC} degrees Celsius (${cur.temperatureF} degrees Fahrenheit), with ${cur.humidity} percent humidity.${forecastText}`;
    }
    if (weatherTool.result?.message) {
      return weatherTool.result.message;
    }
  }
  if (webSearchTool && Array.isArray(webSearchTool.result.data) && webSearchTool.result.data.length > 0) {
    return `According to the latest information: ${webSearchTool.result.data.slice(0, 2).join(' ')}`;
  }
  return toolsExecuted.map(t => t.result.message).join(' ');
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

    this.providerManager = new ProviderManager(process.env.MODEL_PROVIDER || 'auto', this.toolRegistry, this.permissionManager);
  }

  getToolRegistry(): ToolRegistry {
    return this.toolRegistry;
  }

  getMemoryStore(): MemoryStore {
    return this.memoryStore;
  }

  getSessionManager(): SessionManager {
    return this.contextManager.getSessionManager();
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

  async handleUserMessageStream(
    userMessage: string,
    config: AgentConfig = {},
    onChunk: (chunk: string) => void,
    signal?: AbortSignal,
    sessionId?: string
  ): Promise<{ response: string; modelUsed: string; sessionId: string }> {
    const sessionManager = this.contextManager.getSessionManager();
    let targetSessionId = sessionId;
    if (!targetSessionId) {
      const activeList = sessionManager.listSessions({ includeArchived: false });
      if (activeList.length > 0) {
        targetSessionId = activeList[0].id;
      } else {
        const newSession = sessionManager.createSession('New Conversation', 'General');
        targetSessionId = newSession.id;
      }
    }

    // Persist user message IMMEDIATELY to session before calling provider
    const userMsg = sessionManager.addMessage(
      targetSessionId,
      'user',
      userMessage,
      { status: 'delivered', pending: true }
    );

    const isConversational = config.mode === 'conversational' || config.mode === 'chat';
    if (!config.maxTokens) {
      config.maxTokens = 2048;
    }

    const messages = this.contextManager.buildPromptMessages(
      userMessage,
      this.conversationHistory,
      config,
      targetSessionId
    );

    let fullResponse = '';
    const chunkCollector = (chunk: string) => {
      fullResponse += chunk;
      onChunk(chunk);
    };

    const normalizedUserMsg = normalizeVoiceInput(userMessage);

    const allDefs = this.toolRegistry.getAllDefinitions();
    let streamToolDefs = (config.toolsEnabled === false)
      ? []
      : selectRelevantTools(normalizedUserMsg, allDefs, config.modelProvider);

    // 1. Ultra-Fast Weather Prefetch: Fetch live Open-Meteo meteorological reports in ~200ms
    const isWeatherQuery = streamToolDefs.some(t => t.name === 'predict_weather' || t.name === 'get_weather') ||
      /\b(weather|wether|forecast|temperature|temprature|rain|raining|snow|sunny|humidity)\b/i.test(normalizedUserMsg);

    if (isWeatherQuery) {
      const loc = extractWeatherLocation(normalizedUserMsg) ||
        this.memoryStore.getPreference('location') ||
        this.memoryStore.getPreference('city') ||
        'Paris';
      try {
        const weatherRes = await this.toolRegistry.execute('predict_weather', { location: loc, days: 3 });
        if (weatherRes.success && weatherRes.message) {
          messages.push({
            role: 'tool',
            content: weatherRes.message,
            toolCallId: 'call_weather_' + Date.now(),
            toolResult: weatherRes
          });
          // Weather forecast is embedded as ground truth; stream spoken synthesis directly!
          streamToolDefs = [];
        }
      } catch (e: any) {
        console.warn('[AGENT CORE] Weather prefetch notice:', e.message);
      }
    }

    // 2. Ultra-Fast Live Augmentation: If query asks for live news, current events, or search,
    // pre-fetch real-time web facts in ~500ms so the streaming LLM answers immediately in <2s!
    const isLiveSearchQuery = !isWeatherQuery && streamToolDefs.some(t => t.name === 'web_search') && (
      /\b(news|latest|today|current|recent|who is|who won|score|winner|what happened|stock|price|election|super bowl|championship)\b/i.test(normalizedUserMsg) ||
      normalizedUserMsg.toLowerCase().includes('search') ||
      normalizedUserMsg.toLowerCase().includes('online')
    );

    if (isLiveSearchQuery) {
      try {
        const searchRes = await this.toolRegistry.execute('web_search', { query: normalizedUserMsg });
        if (searchRes.success && searchRes.message) {
          messages.push({
            role: 'tool',
            content: searchRes.message,
            toolCallId: 'call_live_' + Date.now(),
            toolResult: searchRes
          });
          // Live search results are embedded; stream directly with no tool overhead!
          streamToolDefs = [];
        }
      } catch (e: any) {
        console.warn('[AGENT CORE] Live search prefetch notice:', e.message);
      }
    }

    let res: { response: AgentMessage; providerUsed: string };
    try {
      res = await this.providerManager.generateResponseStream(
        messages,
        streamToolDefs,
        config,
        chunkCollector,
        signal
      );

      // If the model invoked tools (e.g. web_search, weather, notes, tasks), execute them and stream final synthesis
      if (res.response?.toolCalls && res.response.toolCalls.length > 0) {
        const toolsExecuted: Array<{ name: string; parameters: any; result: any }> = [];
        for (const tc of res.response.toolCalls) {
          const result = await this.toolRegistry.execute(tc.name, tc.arguments);
          toolsExecuted.push({ name: tc.name, parameters: tc.arguments, result });

          messages.push({
            role: 'assistant',
            content: res.response.content || '',
            toolCalls: [tc]
          });

          messages.push({
            role: 'tool',
            content: JSON.stringify(result.data || result.message),
            toolCallId: tc.id,
            toolResult: result
          });
        }

        // Now stream the synthesized answer with tool results embedded
        const synthConfig = { ...config, toolsEnabled: false };
        try {
          res = await this.providerManager.generateResponseStream(
            messages,
            [],
            synthConfig,
            chunkCollector,
            signal
          );
        } catch (synthErr: any) {
          const fallbackText = synthesizeToolResults(toolsExecuted);
          chunkCollector(fallbackText);
          res = { response: { role: 'assistant', content: fallbackText }, providerUsed: res.providerUsed };
        }
      }
    } catch (err: any) {
      const partial = fullResponse.trim();
      const content = partial || 'Answer interrupted, no reply produced.';
      sessionManager.updateMessage(targetSessionId, userMsg.id, { pending: false, status: 'delivered' });
      sessionManager.addMessage(targetSessionId, 'assistant', content, {
        status: 'error',
        interrupted: true,
        modelUsed: 'interrupted_stream'
      });
      throw err;
    }

    if (signal?.aborted) {
      const partial = fullResponse.trim();
      const content = partial || 'Answer interrupted, no reply produced.';
      sessionManager.updateMessage(targetSessionId, userMsg.id, { pending: false, status: 'delivered' });
      sessionManager.addMessage(targetSessionId, 'assistant', content, {
        status: 'error',
        interrupted: true,
        modelUsed: 'interrupted_stream'
      });
      return {
        response: content,
        modelUsed: res.providerUsed || 'interrupted',
        sessionId: targetSessionId
      };
    }

    const finalResponse = (fullResponse.trim() || res.response.content || "I'm right here with you.").trim();
    if (!fullResponse.trim() && finalResponse) {
      onChunk(finalResponse);
    }

    // Success path: update pending turn, persist assistant message
    sessionManager.updateMessage(targetSessionId, userMsg.id, { pending: false, status: 'delivered' });
    sessionManager.addMessage(targetSessionId, 'assistant', finalResponse, {
      status: 'delivered',
      modelUsed: res.providerUsed
    });

    this.memoryStore.addHistoryTurn('user', userMessage);
    this.memoryStore.addHistoryTurn('assistant', finalResponse);

    this.maybeTriggerSummarization(targetSessionId);

    return {
      response: finalResponse,
      modelUsed: res.providerUsed,
      sessionId: targetSessionId
    };
  }

  async handleUserMessage(
    userMessage: string,
    config: AgentConfig = {},
    sessionId?: string
  ): Promise<AgentChatResponse> {
    const sessionManager = this.contextManager.getSessionManager();
    let targetSessionId = sessionId;
    if (!targetSessionId) {
      const activeList = sessionManager.listSessions({ includeArchived: false });
      if (activeList.length > 0) {
        targetSessionId = activeList[0].id;
      } else {
        const newSession = sessionManager.createSession('New Conversation', 'General');
        targetSessionId = newSession.id;
      }
    }

    // Persist user message IMMEDIATELY to session before calling provider
    const userMsg = sessionManager.addMessage(
      targetSessionId,
      'user',
      userMessage,
      { status: 'delivered', pending: true }
    );

    const isChatMode = config.mode === 'chat' || config.mode === 'conversational';
    const maxIterations = isChatMode ? 2 : (config.maxToolIterations || 3);
    // Guard against acoustic microphone self-echo looping into chat
    const lastAssistant = [...this.conversationHistory].reverse().find(m => m.role === 'assistant');
    if (lastAssistant && lastAssistant.content.trim() && userMessage.trim().length > 12) {
      const cleanUser = userMessage.toLowerCase().replace(/[^a-z0-9]/g, '');
      const cleanAssistant = lastAssistant.content.toLowerCase().replace(/[^a-z0-9]/g, '');
      if (cleanUser === cleanAssistant || (cleanAssistant.length > 25 && cleanAssistant.includes(cleanUser) && cleanUser.length > 20)) {
        sessionManager.updateMessage(targetSessionId, userMsg.id, { pending: false, status: 'delivered' });
        return {
          response: "I'm right here listening whenever you're ready.",
          status: 'speaking',
          toolsExecuted: [],
          modelUsed: 'echo_guard',
          memoriesRecalled: [],
          sessionId: targetSessionId
        };
      }
    }

    const toolsExecuted: AgentChatResponse['toolsExecuted'] = [];
    const memoriesRecalled = this.memoryStore.recall(userMessage).map((m) => `${m.key}: ${m.value}`);

    // Build message list with system prompt and history
    const messages = this.contextManager.buildPromptMessages(
      userMessage,
      this.conversationHistory,
      config,
      targetSessionId
    );

    let iteration = 0;
    let finalContent = '';
    let pendingConfirmation: PendingConfirmation | null = null;
    let lastProviderUsed = 'unknown';

    try {
      while (iteration < maxIterations) {
        iteration++;

        const allDefs = this.toolRegistry.getAllDefinitions();
        let toolDefs = (config.toolsEnabled === false || isChatMode)
          ? []
          : selectRelevantTools(normalizeVoiceInput(userMessage), allDefs, config.modelProvider);

        if (iteration > 1 && toolsExecuted.length > 0) {
          toolDefs = [];
        }

        const { response: providerRes, providerUsed } = await this.providerManager.generateResponse(
          messages,
          toolDefs,
          config
        );
        lastProviderUsed = providerUsed;

        if (providerRes.toolCalls && providerRes.toolCalls.length > 0) {
          for (const tc of providerRes.toolCalls) {
            const toolDef = this.toolRegistry.getTool(tc.name)?.definition;

            if (toolDef && this.permissionManager.requiresConfirmation(toolDef)) {
              pendingConfirmation = this.permissionManager.createPendingConfirmation(tc.name, tc.arguments);
              sessionManager.updateMessage(targetSessionId, userMsg.id, { pending: false, status: 'delivered' });
              return {
                response: `This action requires your confirmation: ${toolDef.description}. Would you like me to proceed with ${tc.name}?`,
                status: 'awaiting_confirmation',
                pendingConfirmation,
                modelUsed: lastProviderUsed,
                memoriesRecalled,
                sessionId: targetSessionId
              };
            }

            const result = await this.toolRegistry.execute(tc.name, tc.arguments);
            toolsExecuted.push({
              name: tc.name,
              parameters: tc.arguments,
              result
            });

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

          if (providerUsed === 'local_fallback' || isChatMode) {
            finalContent = synthesizeToolResults(toolsExecuted);
            break;
          }

          if (iteration >= maxIterations) {
            finalContent = synthesizeToolResults(toolsExecuted);
            break;
          }
        } else {
          finalContent = providerRes.content;
          break;
        }
      }

      if (!finalContent) {
        finalContent = synthesizeToolResults(toolsExecuted);
      }
    } catch (err: any) {
      sessionManager.updateMessage(targetSessionId, userMsg.id, { pending: false, status: 'delivered' });
      sessionManager.addMessage(targetSessionId, 'assistant', 'Answer interrupted, no reply produced.', {
        status: 'error',
        interrupted: true,
        modelUsed: 'error_handler'
      });
      throw err;
    }

    // Success path: update pending turn, persist assistant message
    sessionManager.updateMessage(targetSessionId, userMsg.id, { pending: false, status: 'delivered' });
    sessionManager.addMessage(targetSessionId, 'assistant', finalContent, {
      status: 'delivered',
      modelUsed: lastProviderUsed
    });

    this.memoryStore.addHistoryTurn('user', userMessage);
    this.memoryStore.addHistoryTurn('assistant', finalContent);

    this.maybeTriggerSummarization(targetSessionId);

    return {
      response: finalContent,
      status: 'speaking',
      toolsExecuted,
      modelUsed: lastProviderUsed,
      memoriesRecalled,
      sessionId: targetSessionId
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

  private maybeTriggerSummarization(sessionId: string): void {
    const sessionManager = this.contextManager.getSessionManager();
    const data = sessionManager.getSession(sessionId);
    if (!data) return;

    const count = data.messages.length;
    // Trigger if session has 6+ messages and has no summary or message count is divisible by 4
    if (count >= 6 && (!data.session.summary || count % 4 === 0)) {
      this.triggerBackgroundSummarization(sessionId).catch(err => {
        console.warn('[AgentCore] Summarization background catch:', err?.message || err);
      });
    }
  }

  public async triggerBackgroundSummarization(sessionId: string): Promise<void> {
    const sessionManager = this.contextManager.getSessionManager();
    const sessionData = sessionManager.getSession(sessionId);
    if (!sessionData || sessionData.messages.length < 4) return;

    try {
      const turns = sessionData.messages.slice(-12).map(m => `${m.role === 'user' ? 'User' : 'Aura'}: ${m.content}`).join('\n');
      const prompt: AgentMessage[] = [
        {
          role: 'system',
          content: 'You are an analytical AI conversation summarizer. Given a dialogue, output:\nTOPIC: <2-4 word primary topic>\nSUMMARY: <2-3 sentence rolling summary of discussed topics and agreements>\nFACTS:\n- <important established requirement or decision>\n- <important established preference or goal>\nOnly output this format without preamble.'
        },
        {
          role: 'user',
          content: `Transcript turns:\n${turns}\n\nProduce the topic, summary, and facts:`
        }
      ];

      const res = await this.providerManager.generateResponse(prompt, [], { maxTokens: 400 });
      const text = res.response.content || '';

      const topicMatch = text.match(/TOPIC:\s*(.+)/i);
      const summaryMatch = text.match(/SUMMARY:\s*([\s\S]+?)(?=(?:FACTS:|$))/i);
      const factsMatch = text.match(/FACTS:\s*([\s\S]+)/i);

      const topic = topicMatch ? topicMatch[1].trim() : undefined;
      const summary = summaryMatch ? summaryMatch[1].trim() : undefined;
      const facts = factsMatch
        ? factsMatch[1].split(/\n/).map(l => l.replace(/^[-*•]\s*/, '').trim()).filter(Boolean)
        : [];

      if (summary && summary.trim().length > 10) {
        sessionManager.updateRollingSummary(sessionId, summary, facts, topic);
      }
    } catch (err) {
      console.warn('[AgentCore] Notice in background summarization:', err);
    }
  }
}
