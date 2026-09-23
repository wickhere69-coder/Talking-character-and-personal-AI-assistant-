export interface AgentChatResponse {
  response: string;
  status: 'idle' | 'listening' | 'thinking' | 'executing_tool' | 'speaking' | 'error' | 'awaiting_confirmation';
  toolsExecuted?: Array<{
    name: string;
    parameters: Record<string, any>;
    result: { success: boolean; message: string; data?: any; error?: string };
  }>;
  pendingConfirmation?: {
    id: string;
    toolName: string;
    description: string;
    parameters: Record<string, any>;
  } | null;
  modelUsed: string;
  memoriesRecalled?: string[];
}

export async function sendAgentMessage(
  message: string,
  config?: { mode?: 'agent' | 'chat' | 'repeat' | 'conversational'; modelProvider?: string; maxTokens?: number }
): Promise<AgentChatResponse> {
  const res = await fetch('/api/agent/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, config })
  });

  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(errData.error || `Agent server error (${res.status})`);
  }

  return await res.json();
}

/**
 * Streams response from agent and yields completed sentences as they arrive.
 * Enables sentence-by-sentence TTS synthesis for sub-second time-to-first-sound.
 */
export async function streamAgentConversation(
  message: string,
  config: { mode?: 'agent' | 'chat' | 'repeat' | 'conversational'; modelProvider?: string; maxTokens?: number } = {},
  callbacks: {
    onSentence?: (sentence: string) => void;
    onChunk?: (chunk: string) => void;
    onComplete?: (fullResponse: string, modelUsed: string) => void;
    onError?: (error: Error) => void;
  },
  signal?: AbortSignal
): Promise<void> {
  try {
    const res = await fetch('/api/agent/stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message,
        config: {
          ...config,
          mode: config.mode || 'conversational'
        }
      }),
      signal
    });

    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.error || `Agent streaming error (${res.status})`);
    }

    if (!res.body) {
      throw new Error('Streaming response body unavailable');
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let sentenceBuffer = '';
    let accumulatedResponse = '';
    let modelUsed = 'unknown';
    let sseLineBuffer = '';
    let dispatchedSentenceCount = 0;

    const dispatchSentence = (rawSentence: string) => {
      // Strip markdown symbols (*, #, `, _, ~) so spoken audio is completely clean and natural
      const cleaned = rawSentence.replace(/[*#`_~]/g, '').trim();
      if (cleaned.length > 0 && callbacks.onSentence) {
        dispatchedSentenceCount++;
        callbacks.onSentence(cleaned);
      }
    };

    while (true) {
      if (signal?.aborted) {
        await reader.cancel();
        return;
      }

      const { done, value } = await reader.read();
      if (done) break;

      const text = decoder.decode(value, { stream: true });
      sseLineBuffer += text;

      const lines = sseLineBuffer.split('\n');
      sseLineBuffer = lines.pop() || ''; // keep trailing partial line

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith('data:')) continue;

        const dataStr = trimmed.slice(5).trim();
        if (!dataStr) continue;

        try {
          const parsed = JSON.parse(dataStr);

          if (parsed.error) {
            throw new Error(parsed.error);
          }

          if (parsed.chunk) {
            const chunk = parsed.chunk;
            accumulatedResponse += chunk;
            sentenceBuffer += chunk;
            callbacks.onChunk?.(chunk);

            // Split on sentence boundaries and pauses (. ! ? , ; :) for much faster time-to-first-sound
            const match = sentenceBuffer.match(/^(.*?[.!?,;:]["']?)(?:\s+|\n+)(.*)$/s);
            if (match) {
              const sentence = match[1];
              sentenceBuffer = match[2];
              dispatchSentence(sentence);
            }
          }

          if (parsed.done) {
            if (parsed.fullResponse) {
              accumulatedResponse = parsed.fullResponse;
            }
            if (parsed.modelUsed) {
              modelUsed = parsed.modelUsed;
            }
          }
        } catch (parseErr: any) {
          // Ignore JSON parse errors for SSE heartbeat or partial frames
        }
      }
    }

    // Flush any remaining partial sentence in the buffer
    if (sentenceBuffer.trim().length > 0) {
      dispatchSentence(sentenceBuffer.trim());
      sentenceBuffer = '';
    } else if (dispatchedSentenceCount === 0 && accumulatedResponse.trim().length > 0) {
      // If no partial sentence was flushed but full response exists, dispatch it immediately
      dispatchSentence(accumulatedResponse.trim());
    }

    callbacks.onComplete?.(accumulatedResponse.trim(), modelUsed);
  } catch (err: any) {
    if (signal?.aborted || err.name === 'AbortError') {
      // Intentional abort (e.g. user barged in and interrupted)
      return;
    }
    callbacks.onError?.(err instanceof Error ? err : new Error(String(err)));
  }
}

export async function resolveAgentConfirmation(
  confirmationId: string,
  approved: boolean
): Promise<AgentChatResponse> {
  const res = await fetch('/api/agent/confirm', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ confirmationId, approved })
  });

  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(errData.error || `Failed to resolve confirmation`);
  }

  return await res.json();
}

export async function getAgentHealth(): Promise<any> {
  try {
    const res = await fetch('/api/agent/health');
    if (res.ok) {
      return await res.json();
    }
  } catch {}
  return null;
}

export async function getAgentHistory(): Promise<Array<{ role: string; content: string }>> {
  try {
    const res = await fetch('/api/agent/history');
    if (res.ok) {
      const data = await res.json();
      return data.history || [];
    }
  } catch {}
  return [];
}

export async function clearAgentHistory(): Promise<boolean> {
  try {
    const res = await fetch('/api/agent/clear-history', { method: 'POST' });
    return res.ok;
  } catch {}
  return false;
}

export async function saveAgentApiKey(provider: 'grok' | 'gemini' | 'elevenlabs', apiKey: string): Promise<boolean> {
  try {
    const res = await fetch('/api/agent/save-key', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider, apiKey })
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function getAgentKeyStatus(): Promise<{ grok: boolean; gemini: boolean; elevenlabs: boolean }> {
  try {
    const res = await fetch('/api/agent/key-status');
    if (res.ok) {
      return await res.json();
    }
  } catch {}
  return { grok: false, gemini: false, elevenlabs: false };
}

