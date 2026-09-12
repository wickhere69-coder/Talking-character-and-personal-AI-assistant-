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

    const isChat = config.mode === 'chat';
    const systemPrompt = isChat
      ? `You are an intelligent, articulate, and knowledgeable AI assistant.
${temporalContext}
IMPORTANT: Your internal knowledge cutoff is in the past. Today is ${dateStr} in ${currentYear}.
Instructions:
- If asked about weather, current conditions, or future weather forecasts/predictions for any location, ALWAYS call the predict_weather tool to get accurate meteorological predictions.
- If asked about current political leaders, officeholders, who is president, recent technology, releases, news, or any real-time facts, ALWAYS call the web_search tool to check current reality. DO NOT assume past presidents or old data.
- Provide accurate, insightful, and natural spoken answers.
- Speak in 2 to 4 clear, well-formed sentences suitable for speech synthesis.
- Never give outdated or obsolete answers; always speak with modern ${currentYear} awareness.`.trim()
      : `You are an intelligent, articulate AI Personal Assistant and workspace companion.
${temporalContext}
IMPORTANT: Your internal knowledge cutoff is in the past. Today is ${dateStr} in ${currentYear}.
Capabilities: answering questions, predicting and checking real-time weather forecasts, searching the live web, managing local files, inspecting CPU/RAM, tracking tasks and notes.
${prefSummary ? `Preferences:\n${prefSummary}\n` : ''}${recallSummary ? `Memories:\n${recallSummary}\n` : ''}Instructions:
- If asked about weather, current conditions, or future weather forecasts/predictions for any location, ALWAYS call the predict_weather tool to get accurate meteorological predictions.
- If asked about current political leaders, officeholders, who is president, recent technology, releases, news, or any real-time facts, ALWAYS call the web_search tool to check current reality. DO NOT assume past presidents or old data.
- Provide accurate, insightful, friendly, and conversational responses in 2 to 4 spoken sentences.
- Never give outdated answers; always speak with modern ${currentYear} awareness.`.trim();

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
