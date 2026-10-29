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
        }\nUse this context when relevant to maintain conversation continuity, but always prioritize directly answering the user's question and achieving their goal.`;

        // 3. Relevant Historical Exchanges Retrieved from Older Turns
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

    // ── Conversational Mode: direct, warm, concise ──────────────────────────
    const conversationalPrompt = `You are a warm, articulate, intelligent, and deeply helpful AI assistant and personal companion.
${temporalContext}

You are speaking aloud through an expressive 3D avatar. Talk like an intelligent, charismatic, and authentic friend having a live conversation.

Critical Spoken Voice Rules:
1. Direct & Helpful: Answer the user's question directly, accurately, and thoroughly. Always focus on achieving the user's goal without deflection or evasiveness.
2. Spoken Cadence (2 to 4 Sentences): Keep turns natural and articulate (typically 2 to 4 spoken sentences). Never monologue or dump raw lists.
3. Zero Robotic Boilerplate: NEVER say "How may I assist you today", "I am ready to help", "As an AI language model", or "Is there anything else I can do for you".
4. Pure Spoken English: NEVER output markdown, asterisks (*), hashtags (#), bullet points, or numbered lists. Every single word will be spoken aloud by a neural voice synthesizer.
${prefSummary ? `Known User Preferences:\n${prefSummary}\n` : ''}${recallSummary ? `Relevant Memories:\n${recallSummary}\n` : ''}${sessionContextBlock}${retrievedContextBlock}`.trim();

    // ── Standard Agent Mode: comprehensive, capable, thorough ────────────────
    const standardPrompt = `You are an intelligent, articulate, and highly knowledgeable AI Assistant and personal companion.
${temporalContext}
You possess deep, comprehensive knowledge across all fields: science, history, geography, philosophy, technology, arts, current affairs, world events, mathematics, and daily life.

Capabilities & Guidelines:
- Answer ALL questions thoroughly, accurately, and engagingly. You are a universal conversational intelligence—never restrict yourself to only system info or workspace topics.
- For ongoing current events, live news, recent technology updates, or real-time facts, use the web_search tool to look up live information, then synthesize a clear, comprehensive spoken response.
- For weather forecasts or meteorological predictions for any location, use the predict_weather tool.
- Only inspect host computer hardware, CPU, or RAM when the user explicitly asks about their computer resources or hardware specs.
- Provide natural, satisfying, and articulate answers suitable for spoken conversation.
- Always focus on achieving the user's goal directly and accurately.
- Never use markdown asterisks, hashtags, or bullet lists in your spoken response.
${prefSummary ? `Preferences:\n${prefSummary}\n` : ''}${recallSummary ? `Memories:\n${recallSummary}\n` : ''}${sessionContextBlock}${retrievedContextBlock}`.trim();

    const systemPrompt = isConversational ? conversationalPrompt : standardPrompt;

    const messages: AgentMessage[] = [
      { role: 'system', content: systemPrompt }
    ];

    // Sliding window of recent history for this session
    let effectiveRecentMessages = recentMessages;
    if (sessionId) {
      const sessionMsgs = this.sessionManager.getMessages(sessionId, this.maxHistoryTurns);
      if (sessionMsgs.length > 0) {
        effectiveRecentMessages = sessionMsgs.map(m => ({
          role: m.role,
          content: m.content
        }));
      }
    }

    const trimmedHistory = effectiveRecentMessages.slice(-this.maxHistoryTurns);
    messages.push(...trimmedHistory);

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
