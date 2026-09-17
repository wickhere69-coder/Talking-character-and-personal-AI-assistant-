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
  config?: { mode?: 'agent' | 'chat' | 'repeat'; modelProvider?: string }
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

