import { AgentMessage, AgentConfig } from '../types';
import { MemoryStore } from './MemoryStore';
import { SessionManager, ChatSession, ChatMessage } from './SessionManager';

/**
 * ContextManager — builds the optimal system prompt and message list
 * for every conversation turn, integrating session memory, topic context,
 * rolling summaries, and retrieved historical exchanges.
 */
export class ContextManager {
  private memoryStore: MemoryStore;
  private sessionManager: SessionManager;
  private maxHistoryTurns: number;

  constructor(memoryStore: MemoryStore, sessionManager?: SessionManager, maxHistoryTurns = 8) {
    this.memoryStore = memoryStore;
    this.sessionManager = sessionManager || new SessionManager();
    this.maxHistoryTurns = maxHistoryTurns;
  }

  public getSessionManager(): SessionManager {
    return this.sessionManager;
  }

  buildPromptMessages(
    userMessage: string,
    recentMessages: AgentMessage[],
    config: AgentConfig,
    sessionId?: string
  ): AgentMessage[] {
    const preferences = this.memoryStore.getPreferences();
    const prefSummary = Object.entries(preferences)
      .map(([k, v]) => `• ${k}: ${v}`)
      .join('\n');

    const recalled = this.memoryStore.recall(userMessage);
    const recallSummary = recalled.slice(0, 5).map((m) => `• ${m.key}: ${m.value}`).join('\n');

    const now = new Date();
    const dateStr = now.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
    const timeStr = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
    const currentYear = now.getFullYear();
    const temporalContext = `Today's Date: ${dateStr}. Current Time: ${timeStr}. Current Year: ${currentYear}.`;

    const isConversational = config.mode === 'conversational' || config.mode === 'chat';

    // ── Session Context Assembly (Priority Order) ──────────────────────────
    let sessionContextBlock = '';
    let retrievedContextBlock = '';
    let lastExchangeBlock = '';
    let interruptedBlock = '';
    let historyMsgs: ChatMessage[] = [];

    if (sessionId) {
      const sessionData = this.sessionManager.getSession(sessionId);
      if (sessionData) {
        const targetSession = sessionData.session;

        // 1. Session Title & Primary Topic
        const titleLine = `Active Session: "${targetSession.title}"`;
        const topicLine = `Session Topic: "${targetSession.topic}"`;

        // 2. Rolling Summary & Established Facts / Decisions
        const summaryLines: string[] = [];
        if (targetSession.summary?.trim()) {
          summaryLines.push(`Established Summary:\n${targetSession.summary.trim()}`);
        }
        if (targetSession.establishedFacts?.length > 0) {
          const facts = targetSession.establishedFacts.map(f => `  • ${f}`).join('\n');
          summaryLines.push(`Key Decisions & Requirements Established in This Session:\n${facts}`);
        }

        sessionContextBlock = `\n\n[Active Session Context]\n${titleLine}\n${topicLine}${
          summaryLines.length > 0 ? '\n' + summaryLines.join('\n') : ''
        }`;

        // Filter messages to completed history turns (excluding current in-flight pending turn)
        historyMsgs = (sessionData.messages || []).filter(m => !m.pending && m.content !== userMessage);

        // 3. Explicit Last Exchange in This Conversation
        if (historyMsgs.length > 0) {
          const lastAssistant = [...historyMsgs].reverse().find(m => m.role === 'assistant');
          const lastUser = [...historyMsgs].reverse().find(m => m.role === 'user');

          if (lastUser || lastAssistant) {
            const uText = lastUser ? lastUser.content : '(none)';
            const aText = lastAssistant ? lastAssistant.content : '(none)';
            lastExchangeBlock = `\n\n[Last Exchange in This Conversation]\nUser previously asked: "${uText}"\nAura previously answered: "${aText}"`;
          }

          if (lastAssistant?.interrupted) {
            interruptedBlock = `\n\n[Interrupted Answer Notice]\nThe previous answer was interrupted part-way through: "${lastAssistant.content}".\nIf the user says continue / go on, resume from that partial answer, do not restart the topic and do not claim it never happened.`;
          }
        }

        // 4. Relevant Historical Exchanges Retrieved from Older Turns
        const retrievedOlderMessages = this.sessionManager.retrieveRelevantMessages(
          sessionId,
          userMessage,
          4,
          this.maxHistoryTurns
        );

        if (retrievedOlderMessages.length > 0) {
          const formattedRetrieved = retrievedOlderMessages.map(m => {
            const speaker = m.role === 'user' ? 'User earlier' : 'Aura earlier';
            return `[${speaker}]: "${m.content}"`;
          }).join('\n');

          retrievedContextBlock = `\n\n[Relevant Earlier Exchanges in This Session]\n${formattedRetrieved}\nInstruction: Refer back to these previous points if the user asks "what did we discuss earlier" or "continue where we stopped". Never invent false statements.`;
        }
      }
    }

    const continuityDirective = `\n\n[Conversation Continuity & Follow-Up Rules]
1. References & Pronouns: Pronouns and follow-ups ("that", "the second one", "tell me more", "and then?", "continue", "what did I just ask?", "what were we talking about?") refer directly to the last exchange and session context above. Do not treat a follow-up as a new, unrelated question.
2. Recall: If the user asks "what did I just ask?" or "what was my last question?", state the user's previous question accurately and concisely.
3. Resumption: If the user says "continue", "go on", or resumes after a pause/reload, pick up smoothly from the previous answer or partial answer without starting from scratch. A natural brief resumption cue like "Picking up where we left off — you were asking about X" is welcome when resuming.
4. Fresh Sessions: In a fresh session without prior exchanges, do not invent or reference topics from other sessions.`;

    const longTermMemoryBlock = [
      prefSummary ? `[Known User Preferences (Long-term profile)]\n${prefSummary}` : '',
      recallSummary ? `[Relevant Long-Term Memories (Cross-session knowledge)]\n${recallSummary}` : ''
    ].filter(Boolean).join('\n\n');

    // ── Conversational Mode: direct, warm, concise ──────────────────────────
    const conversationalPrompt = `You are a warm, articulate, intelligent, and deeply helpful AI assistant and personal companion.
${temporalContext}

You are speaking aloud through an expressive 3D avatar. Talk like an intelligent, charismatic, and authentic friend having a live conversation.

Critical Spoken Voice Rules:
1. Adaptive Answering Effort & Length:
- Match your response length and reasoning depth dynamically to the complexity of the question.
- For small, simple, or straightforward questions (such as greetings, basic arithmetic like 2+2, single-fact queries, yes/no, definitions, or quick checks): Give a direct, punchy, 1-sentence answer (or 2 short sentences at most) with zero filler. Never give lengthy answers, background exposition, or unsolicited essays to small questions.
- For medium questions: Give 2 to 3 concise, articulate spoken sentences.
- For complex, analytical, multi-step, or philosophical questions: Scale up your reasoning effort and depth, providing a thorough, structured, and insightful multi-sentence explanation.
2. Automatic Sentence & Typo Auto-Correction:
- Users interact via voice speech-to-text, which frequently introduces phonetic mishearings, garbled words, spelling errors, or dropped syllables (e.g., 'wether in pares' -> 'weather in Paris', 'whats two pul two' -> 'what is 2 plus 2', 'supper bowl' -> 'Super Bowl').
- Automatically infer the user's true intended question, silently correct the sentence in your mind, and answer the intended question directly and accurately. Never scold or lecture the user about errors.
3. Direct & Warm: Answer the user's question directly, accurately, and naturally.
4. Zero Robotic Boilerplate: NEVER say "How may I assist you today", "I am ready to help", "As an AI language model", or "Is there anything else I can do for you".
5. Pure Spoken English: NEVER output markdown, asterisks (*), hashtags (#), bullet points, or numbered lists. Every single word will be spoken aloud by a neural voice synthesizer.
${sessionContextBlock}${lastExchangeBlock}${interruptedBlock}${retrievedContextBlock}${continuityDirective}${longTermMemoryBlock ? '\n\n' + longTermMemoryBlock : ''}`.trim();

    // ── Standard Agent Mode: comprehensive, capable, thorough ────────────────
    const standardPrompt = `You are an intelligent, articulate, and highly knowledgeable AI Assistant and personal companion.
${temporalContext}
You possess deep, comprehensive knowledge across all fields: science, history, geography, philosophy, technology, arts, current affairs, world events, mathematics, and daily life.

Capabilities & Guidelines:
- Adaptive Effort & Length: For simple or small queries, answer directly in 1 crisp sentence without unnecessary fluff. For complex reasoning or multi-step questions, scale reasoning effort up and provide thorough depth.
- Automatic Sentence Auto-Correction: Automatically infer the true intended sentence and question when voice speech-to-text introduces phonetic mishearings or typos (e.g., 'wether in pares' -> 'weather in Paris'), and answer directly.
- Answer ALL questions thoroughly, accurately, and engagingly. You are a universal conversational intelligence—never restrict yourself to only system info or workspace topics.
- For ongoing current events, live news, recent technology updates, or real-time facts, use the web_search tool to look up live information, then synthesize a clear, comprehensive spoken response.
- For weather forecasts or meteorological predictions for any location, use the predict_weather tool.
- Only inspect host computer hardware, CPU, or RAM when the user explicitly asks about their computer resources or hardware specs.
- Provide natural, satisfying, and articulate answers suitable for spoken conversation.
- Always focus on achieving the user's goal directly and accurately.
- Never use markdown asterisks, hashtags, or bullet lists in your spoken response.
${sessionContextBlock}${lastExchangeBlock}${interruptedBlock}${retrievedContextBlock}${continuityDirective}${longTermMemoryBlock ? '\n\n' + longTermMemoryBlock : ''}`.trim();

    const systemPrompt = isConversational ? conversationalPrompt : standardPrompt;

    const messages: AgentMessage[] = [
      { role: 'system', content: systemPrompt }
    ];

    // Sliding window of recent history for this session
    // Strict session isolation: if sessionId is present, use ONLY this session's history
    let effectiveRecentMessages: AgentMessage[] = [];
    if (sessionId) {
      effectiveRecentMessages = historyMsgs.slice(-this.maxHistoryTurns).map(m => ({
        role: m.role as 'user' | 'assistant',
        content: m.content
      }));
    } else {
      effectiveRecentMessages = recentMessages.slice(-this.maxHistoryTurns);
    }

    messages.push(...effectiveRecentMessages);

    // Current user message
    messages.push({ role: 'user', content: userMessage });

    return messages;
  }

  saveTurn(userContent: string, assistantContent: string, sessionId?: string): void {
    // 1. Save to MemoryStore for cross-session long-term facts
    this.memoryStore.addHistoryTurn('user', userContent);
    this.memoryStore.addHistoryTurn('assistant', assistantContent);

    // 2. Save to SessionManager for strict session-isolated conversation history
    if (sessionId) {
      this.sessionManager.addMessage(sessionId, 'user', userContent);
      this.sessionManager.addMessage(sessionId, 'assistant', assistantContent);
    }
  }
}
