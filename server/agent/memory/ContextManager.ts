import { AgentMessage, AgentConfig } from '../types';
import { MemoryStore } from './MemoryStore';

export class ContextManager {
  private memoryStore: MemoryStore;
  private maxHistoryTurns: number;

  constructor(memoryStore: MemoryStore, maxHistoryTurns = 8) {
    this.memoryStore = memoryStore;
    this.maxHistoryTurns = maxHistoryTurns;
  }

  buildPromptMessages(
    userMessage: string,
    recentMessages: AgentMessage[],
    config: AgentConfig
  ): AgentMessage[] {
    // 1. System Prompt with Personality and Context
    const preferences = this.memoryStore.getPreferences();
    const prefSummary = Object.entries(preferences)
      .map(([k, v]) => `• ${k}: ${v}`)
      .join('\n');

    // Retrieve relevant memories for the user's current query
    const recalled = this.memoryStore.recall(userMessage);
    const recallSummary = recalled.slice(0, 5).map((m) => `• ${m.key}: ${m.value}`).join('\n');

    const now = new Date();
    const dateStr = now.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
    const timeStr = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
    const currentYear = now.getFullYear();
    const temporalContext = `Today's Date: ${dateStr}. Current Time: ${timeStr}. Current Year: ${currentYear}.`;

    const systemPrompt = `You are an intelligent, articulate, and highly knowledgeable AI Assistant and personal companion.
${temporalContext}
You possess deep, comprehensive knowledge across all fields: science, history, geography, philosophy, technology, arts, current affairs, world events, mathematics, and daily life.

Capabilities & Guidelines:
- Answer ALL questions thoroughly, accurately, and engagingly. You are a universal conversational intelligence—never restrict yourself to only system info or workspace topics.
- For ongoing current events, live news, recent technology updates, or real-time facts, use the web_search tool to look up live information, then synthesize a clear, comprehensive spoken response.
- For weather forecasts or meteorological predictions for any location, use the predict_weather tool.
- Only inspect host computer hardware, CPU, or RAM when the user explicitly asks about their computer resources or hardware specs.
- Provide natural, satisfying, and articulate answers suitable for spoken conversation.
${prefSummary ? `Preferences:\n${prefSummary}\n` : ''}${recallSummary ? `Memories:\n${recallSummary}\n` : ''}`.trim();

    const messages: AgentMessage[] = [
      {
        role: 'system',
        content: systemPrompt
      }
    ];

    // 2. Sliding window of recent history
    const trimmedHistory = recentMessages.slice(-this.maxHistoryTurns);
    messages.push(...trimmedHistory);

    // 3. Current User Message
    messages.push({
      role: 'user',
      content: userMessage
    });

    return messages;
  }

  saveTurn(userContent: string, assistantContent: string): void {
    this.memoryStore.addHistoryTurn('user', userContent);
    this.memoryStore.addHistoryTurn('assistant', assistantContent);
  }
}
