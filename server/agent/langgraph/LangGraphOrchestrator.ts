/**
 * LangGraph Multi-Node Orchestrator
  * 
 * Full graph pipeline:
 * classify → routeModel → think →[toolCall ?] → synthesize → reflect → output
  *
 * This implements LangGraph's StateGraph pattern in TypeScript without the
  * @langchain / langgraph package dependency, giving us full control.
 */

import axios from 'axios';
import { AgentMessage, AgentConfig, ToolDefinition, ToolResult } from '../types';

// ── Graph State ──────────────────────────────────────────────────────────────

export interface GraphState {
  userMessage: string;
  systemPrompt: string;
  history: AgentMessage[];
  config: AgentConfig;
  tools: ToolDefinition[];

  // Node outputs
  intent: IntentClass;
  complexity: 'low' | 'medium' | 'high' | 'expert';
  selectedModel: 'flash' | 'pro' | 'grok' | 'local';
  thinkingTrace: string;
  toolResults: ToolResultEntry[];
  synthesizedResponse: string;
  reflectionScore: number;
  reflectionFeedback: string;
  finalResponse: string;
  iterationCount: number;
  modelUsed: string;
}

export type IntentClass =
  | 'greeting'           // hi, hello, how are you
  | 'conversational'     // casual chat, emotional support
  | 'knowledge'          // factual questions, general knowledge
  | 'reasoning'          // math, logic, complex analysis
  | 'realtime'           // news, current events, weather
  | 'task'               // system tools, file ops, productivity
  | 'creative'           // writing, storytelling, brainstorming
  | 'code';              // programming help

export interface ToolResultEntry {
  toolName: string;
  args: Record<string, any>;
  result: ToolResult;
}

// ── Gemini API Caller (shared across nodes) ───────────────────────────────────

async function callGemini(
  key: string,
  model: string,
  messages: Array<{ role: string; content: string }>,
  temperature = 0.7,
  maxTokens = 2048,
  timeoutMs = 12000
): Promise<string> {
  const candidates = ['gemini-3.1-flash-lite', 'gemini-3.5-flash-lite', 'gemini-flash-lite-latest'];

  const systemMsg = messages.find(m => m.role === 'system')?.content || '';
  const nonSystem = messages.filter(m => m.role !== 'system');
  const contents = nonSystem.map(m => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content || '' }]
  }));
  if (contents.length === 0) {
    contents.push({ role: 'user', parts: [{ text: 'Hello' }] });
  }

  const payload: any = {
    contents,
    generationConfig: {
      temperature,
      maxOutputTokens: maxTokens
    }
  };
  if (systemMsg) {
    payload.systemInstruction = { parts: [{ text: systemMsg }] };
  }

  for (const candidateModel of candidates) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${candidateModel}:generateContent?key=${key}`;
      const res = await axios.post(url, payload, {
        headers: { 'Content-Type': 'application/json' },
        timeout: timeoutMs
      });
      const text = res.data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';
      if (text) return text;
    } catch (err: any) {
      console.warn(`[LANGGRAPH CANDIDATE NOTICE] ${candidateModel} failed:`, err?.message || err);
      continue;
    }
  }

  return '';
}

// ── Node: Classify Intent ─────────────────────────────────────────────────────

export async function nodeClassify(state: GraphState, key: string): Promise<Partial<GraphState>> {
  const lower = state.userMessage.toLowerCase().trim();

  // Fast local classification — no API call needed for common patterns
  const greetings = ['hi', 'hello', 'hey', 'good morning', 'good evening', 'good night', 'how are you', 'what\'s up', 'howdy', 'sup', 'yo'];
  if (greetings.some(g => lower === g || lower.startsWith(g + ' ') || lower.startsWith(g + ',') || lower.endsWith(' ' + g))) {
    return { intent: 'greeting', complexity: 'low' };
  }

  const realtimeKeywords = ['news', 'today', 'latest', 'current', 'happening', 'weather', 'forecast', 'stock', 'price', 'bitcoin', 'election', 'score', 'live', 'breaking'];
  if (realtimeKeywords.some(k => lower.includes(k))) {
    return { intent: 'realtime', complexity: 'medium' };
  }

  const codeKeywords = ['code', 'program', 'function', 'algorithm', 'debug', 'error', 'javascript', 'python', 'typescript', 'html', 'css', 'api', 'database', 'sql', 'git'];
  if (codeKeywords.some(k => lower.includes(k))) {
    return { intent: 'code', complexity: 'high' };
  }

  const reasoningKeywords = ['solve', 'calculate', 'prove', 'analyze', 'compare', 'explain why', 'how does', 'what causes', 'difference between', 'evaluate', 'critique', 'strategy', 'optimize'];
  if (reasoningKeywords.some(k => lower.includes(k))) {
    return { intent: 'reasoning', complexity: 'high' };
  }

  const taskKeywords = ['open', 'create file', 'delete', 'search files', 'run command', 'set reminder', 'add task', 'note', 'remember'];
  if (taskKeywords.some(k => lower.includes(k))) {
    return { intent: 'task', complexity: 'medium' };
  }

  const creativeKeywords = ['write', 'story', 'poem', 'song', 'essay', 'imagine', 'creative', 'fiction', 'character', 'brainstorm', 'ideas'];
  if (creativeKeywords.some(k => lower.includes(k))) {
    return { intent: 'creative', complexity: 'medium' };
  }

  // Conversational heuristic: short messages without question marks or keywords
  if (lower.length < 60 && !lower.includes('?')) {
    return { intent: 'conversational', complexity: 'low' };
  }

  // Default: knowledge query
  const isComplex = lower.length > 120 || lower.includes('explain') || lower.includes('detail');
  return { intent: 'knowledge', complexity: isComplex ? 'high' : 'medium' };
}

// ── Node: Route Model ─────────────────────────────────────────────────────────

export async function nodeRouteModel(state: GraphState): Promise<Partial<GraphState>> {
  const { intent, complexity, config } = state;

  // Honor explicit model override
  if (config.modelProvider === 'grok') {
    return { selectedModel: 'grok', modelUsed: 'grok' };
  }
  if (config.modelProvider === 'local_fallback' || config.modelProvider === 'instant') {
    return { selectedModel: 'local', modelUsed: 'local_fallback' };
  }

  // Auto-routing logic
  if (intent === 'greeting' || intent === 'conversational') {
    return { selectedModel: 'flash', modelUsed: 'Gemini 3.5 Flash-Lite (Speed Dialogue)' };
  }

  if (intent === 'reasoning' || intent === 'code' || complexity === 'high' || complexity === 'expert') {
    return { selectedModel: 'pro', modelUsed: 'LangGraph Reasoning Engine (Deep CoT)' };
  }

  if (intent === 'realtime') {
    return { selectedModel: 'flash', modelUsed: 'LangGraph Realtime Engine (Live Web)' };
  }

  return { selectedModel: 'flash', modelUsed: 'Gemini 3.5 Flash-Lite (Knowledge Mode)' };
}

// ── Node: Think / Plan ────────────────────────────────────────────────────────

export async function nodeThink(state: GraphState, key: string): Promise<Partial<GraphState>> {
  const { intent, complexity, userMessage, history, systemPrompt, config } = state;

  // No deep thinking needed for simple intents
  if (intent === 'greeting' || intent === 'conversational' || complexity === 'low') {
    return { thinkingTrace: '' };
  }

  const model = 'gemini-3-flash-preview';
  const recentHistory = history.slice(-4).map(m => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content }));

  const thinkingPrompt = `You are an elite reasoning and analytical engine. Perform rigorous step-by-step reasoning on the user's problem.

Intent detected: ${intent}
Complexity level: ${complexity}

Rigorous Reasoning Directives:
1. Deconstruct the user's question into foundational facts, variables, and constraints.
2. For mathematical/logical problems: define variables, write equations, solve step-by-step, and explicitly perform a sanity self-check to guard against common cognitive traps.
3. For coding/technical questions: trace code execution mentally, consider edge cases, time/space complexity, and clean syntax.
4. For science/philosophy/complex analysis: provide deep, multi-perspective nuance, citing established principles.
5. Formulate the definitive, unambiguous answer with full clarity.`;

  try {
    const messages = [
      { role: 'system', content: thinkingPrompt },
      ...recentHistory,
      { role: 'user', content: userMessage }
    ];

    const trace = await callGemini(key, model, messages, 0.2, 2048, 6000);
    return { thinkingTrace: trace };
  } catch {
    return { thinkingTrace: '' };
  }
}

// ── Node: Synthesize Response ─────────────────────────────────────────────────

export async function nodeSynthesize(state: GraphState, key: string): Promise<Partial<GraphState>> {
  const { userMessage, history, systemPrompt, thinkingTrace, toolResults, intent, config, selectedModel } = state;

  const model = 'gemini-3-flash-preview';
  const isConversational = intent === 'greeting' || intent === 'conversational';

  // Build tool context if tools were used
  let toolContext = '';
  if (toolResults.length > 0) {
    toolContext = '\n\nTool Execution Results:\n' + toolResults.map(t =>
      `[${t.toolName}]: ${JSON.stringify(t.result.data || t.result.message)}`
    ).join('\n');
  }

  // Build thinking context
  let thinkContext = '';
  if (thinkingTrace) {
    thinkContext = `\n\nInternal Analytical Reasoning Trace (use this to inform your definitive answer):\n${thinkingTrace}`;
  }

  const synthesizerPrompt = systemPrompt + `

SYNTHESIS INSTRUCTIONS:
- Produce an articulate, highly engaging, and natural spoken response — every word will be read aloud by a voice synthesizer
- NEVER use markdown symbols (*, #, _, ~, backticks, bullets, or headers) so speech is crystal clear
- If answering a reasoning, math, logic, or complex question:
  1. Clearly state the exact correct answer in the opening sentence.
  2. Walk through the clear, intuitive step-by-step proof so the listener understands completely.
  3. Explain briefly why people commonly get it wrong if applicable.
- Speak with warmth, confidence, and brilliant intellect
- NEVER say "based on my analysis" or "according to my thinking" — speak naturally
${toolContext}${thinkContext}`;

  const recentHistory = history.slice(-6).map(m => ({
    role: m.role === 'assistant' ? 'assistant' : 'user',
    content: m.content
  }));

  const messages = [
    { role: 'system', content: synthesizerPrompt },
    ...recentHistory,
    { role: 'user', content: userMessage }
  ];

  const maxTokens = isConversational ? 512 : (config.maxTokens || 2048);
  const temp = isConversational ? 0.85 : 0.65;

  try {
    const response = await callGemini(key, model, messages, temp, maxTokens, 7000);
    return { synthesizedResponse: response };
  } catch (err: any) {
    throw err;
  }
}

// ── Node: Reflect & Grade ─────────────────────────────────────────────────────

export async function nodeReflect(state: GraphState): Promise<Partial<GraphState>> {
  const { synthesizedResponse, userMessage, intent, complexity } = state;

  // Skip reflection for fast paths
  if (intent === 'greeting' || intent === 'conversational' || complexity === 'low') {
    return { reflectionScore: 1.0, reflectionFeedback: 'ok', finalResponse: synthesizedResponse };
  }

  // Heuristic quality checks (no extra API call needed)
  const response = synthesizedResponse.trim();
  let score = 1.0;
  let feedback = 'ok';

  // Penalize very short responses for complex questions
  if (complexity === 'high' && response.split(' ').length < 30) {
    score = 0.4;
    feedback = 'too_short';
  }

  // Penalize markdown leaking into spoken response
  if (/\*\*|##|```|\n-\s/.test(response)) {
    score = 0.3;
    feedback = 'has_markdown';
  }

  // Penalize "I don't know" for knowledge questions
  if (intent === 'knowledge' && /i don't know|i'm not sure/i.test(response) && response.length < 100) {
    score = 0.2;
    feedback = 'insufficient';
  }

  return {
    reflectionScore: score,
    reflectionFeedback: feedback,
    finalResponse: score >= 0.5 ? response : ''
  };
}

// ── Main Graph Runner ─────────────────────────────────────────────────────────

export class LangGraphOrchestrator {
  private maxIterations = 2;

  async run(
    userMessage: string,
    systemPrompt: string,
    history: AgentMessage[],
    tools: ToolDefinition[],
    config: AgentConfig,
    executeToolFn: (name: string, args: Record<string, any>) => Promise<ToolResult>
  ): Promise<{ response: string; modelUsed: string; thinkingTrace?: string }> {
    const key = process.env.GEMINI_API_KEY?.trim();
    if (!key) throw new Error('GEMINI_API_KEY is required for LangGraph orchestration');

    let state: GraphState = {
      userMessage,
      systemPrompt,
      history,
      config,
      tools,
      intent: 'knowledge',
      complexity: 'medium',
      selectedModel: 'flash',
      thinkingTrace: '',
      toolResults: [],
      synthesizedResponse: '',
      reflectionScore: 1.0,
      reflectionFeedback: 'ok',
      finalResponse: '',
      iterationCount: 0,
      modelUsed: 'gemini-flash'
    };

    // ── STEP 1: Classify ──
    const classifyResult = await nodeClassify(state, key);
    state = { ...state, ...classifyResult };

    // ── STEP 2: Route Model ──
    const routeResult = await nodeRouteModel(state);
    state = { ...state, ...routeResult };

    // ── STEP 3: Think (for complex queries) ──
    const thinkResult = await nodeThink(state, key);
    state = { ...state, ...thinkResult };

    // ── STEP 4: Tool Execution (based on intent + selected tools) ──
    if (config.toolsEnabled !== false && state.intent !== 'greeting' && state.intent !== 'conversational') {
      const toolResults: ToolResultEntry[] = [];
      const relevantTools = selectGraphTools(userMessage, tools, state.intent);

      for (const tool of relevantTools.slice(0, 3)) {
        try {
          const args = inferToolArgs(userMessage, tool.name);
          const result = await executeToolFn(tool.name, args);
          if (result.success) {
            toolResults.push({ toolName: tool.name, args, result });
          }
        } catch {
          // Tool execution failure is silent — synthesizer handles it
        }
      }
      state = { ...state, toolResults };
    }

    // ── STEP 5: Synthesize → STEP 6: Reflect (with retry) ──
    for (let iter = 0; iter < this.maxIterations; iter++) {
      state.iterationCount = iter + 1;

      const synthResult = await nodeSynthesize(state, key);
      state = { ...state, ...synthResult };

      const reflectResult = await nodeReflect(state);
      state = { ...state, ...reflectResult };

      if (state.reflectionScore >= 0.5 || iter === this.maxIterations - 1) {
        break;
      }

      // If quality too low, add feedback and retry synthesis
      state.thinkingTrace += `\n\nPrevious response was graded: ${state.reflectionFeedback}. Improve it.`;
    }

    const finalResponse = state.finalResponse || state.synthesizedResponse || "I'm here for you. What's on your mind?";

    return {
      response: finalResponse,
      modelUsed: state.modelUsed,
      thinkingTrace: state.thinkingTrace || undefined
    };
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function selectGraphTools(userMessage: string, tools: ToolDefinition[], intent: IntentClass): ToolDefinition[] {
  const lower = userMessage.toLowerCase();

  if (intent === 'realtime') {
    return tools.filter(t => t.name === 'web_search' || t.name === 'fetch_webpage' || t.name === 'predict_weather');
  }
  if (intent === 'task') {
    return tools.filter(t => ['add_task', 'list_tasks', 'add_note', 'list_notes', 'remember_info', 'recall_info', 'list_files', 'check_resources'].includes(t.name));
  }
  const weatherWords = ['weather', 'forecast', 'rain', 'temperature', 'sunny', 'cloudy'];
  if (weatherWords.some(w => lower.includes(w))) {
    return tools.filter(t => t.name === 'predict_weather' || t.name === 'get_weather');
  }
  const webWords = ['news', 'latest', 'current', 'search', 'who is', 'what happened'];
  if (webWords.some(w => lower.includes(w))) {
    return tools.filter(t => t.name === 'web_search');
  }
  return [];
}

function inferToolArgs(userMessage: string, toolName: string): Record<string, any> {
  const lower = userMessage.toLowerCase();

  switch (toolName) {
    case 'web_search':
      return { query: userMessage };
    case 'predict_weather':
    case 'get_weather': {
      const cityMatch = userMessage.match(/in\s+([A-Za-z\s]+?)(?:\?|$|,)/i);
      return { location: cityMatch?.[1]?.trim() || 'current location' };
    }
    case 'add_task': {
      const taskMatch = userMessage.match(/(?:add task|remind me to|task:?)\s+(.+)/i);
      return { title: taskMatch?.[1]?.trim() || userMessage, priority: 'medium' };
    }
    case 'add_note': {
      const noteMatch = userMessage.match(/(?:note|remember):?\s*(.+)/i);
      return { title: 'Quick Note', content: noteMatch?.[1]?.trim() || userMessage };
    }
    case 'list_files':
      return { path: '.', recursive: false };
    case 'check_resources':
      return {};
    default:
      return {};
  }
}
