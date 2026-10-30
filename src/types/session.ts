export interface ChatMessage {
  id: string;
  sessionId: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  createdAt: number;
  status: 'sent' | 'delivered' | 'streaming' | 'error' | 'pending' | 'failed';
  modelUsed?: string;
  audioDurationMs?: number;
  interrupted?: boolean;
  pending?: boolean;
  attachment?: {
    name: string;
    type: string;
    url?: string;
  };
}

export interface ChatSession {
  id: string;
  title: string;
  topic: string;
  summary: string;
  establishedFacts: string[];
  createdAt: number;
  updatedAt: number;
  pinned: boolean;
  pinnedAt: number | null;
  archived: boolean;
  archivedAt: number | null;
  messageCount: number;
}

export type SessionPeriod = 'pinned' | 'today' | 'previous_7_days' | 'older' | 'archived';

export interface GroupedSessions {
  pinned: ChatSession[];
  today: ChatSession[];
  previous7Days: ChatSession[];
  older: ChatSession[];
  archived: ChatSession[];
}

