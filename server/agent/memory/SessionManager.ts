import fs from 'fs';
import path from 'path';

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

interface SessionsDataSchema {
  version: number;
  sessions: ChatSession[];
  messages: Record<string, ChatMessage[]>;
}

const STOPWORDS = new Set([
  'a', 'about', 'above', 'after', 'again', 'against', 'all', 'am', 'an', 'and', 'any', 'are', 'aren\'t',
  'as', 'at', 'be', 'because', 'been', 'before', 'being', 'below', 'between', 'both', 'but', 'by',
  'can', 'can\'t', 'cannot', 'could', 'couldn\'t', 'did', 'didn\'t', 'do', 'does', 'doesn\'t', 'doing',
  'don\'t', 'down', 'during', 'each', 'few', 'for', 'from', 'further', 'had', 'hadn\'t', 'has', 'hasn\'t',
  'have', 'haven\'t', 'having', 'he', 'he\'d', 'he\'ll', 'he\'s', 'her', 'here', 'here\'s', 'hers',
  'herself', 'him', 'himself', 'his', 'how', 'how\'s', 'i', 'i\'d', 'i\'ll', 'i\'m', 'i\'ve', 'if',
  'in', 'into', 'is', 'isn\'t', 'it', 'it\'s', 'its', 'itself', 'let\'s', 'me', 'more', 'most', 'mustn\'t',
  'my', 'myself', 'no', 'nor', 'not', 'of', 'off', 'on', 'once', 'only', 'or', 'other', 'ought', 'our',
  'ours', 'ourselves', 'out', 'over', 'own', 'same', 'shan\'t', 'she', 'she\'d', 'she\'ll', 'she\'s',
  'should', 'shouldn\'t', 'so', 'some', 'such', 'than', 'that', 'that\'s', 'the', 'their', 'theirs',
  'them', 'themselves', 'then', 'there', 'there\'s', 'these', 'they', 'they\'d', 'they\'ll', 'they\'re',
  'they\'ve', 'this', 'those', 'through', 'to', 'too', 'under', 'until', 'up', 'very', 'was', 'wasn\'t',
  'we', 'we\'d', 'we\'ll', 'we\'re', 'we\'ve', 'were', 'weren\'t', 'what', 'what\'s', 'when', 'when\'s',
  'where', 'where\'s', 'which', 'while', 'who', 'who\'s', 'whom', 'why', 'why\'s', 'with', 'won\'t',
  'would', 'wouldn\'t', 'you', 'you\'d', 'you\'ll', 'you\'re', 'you\'ve', 'your', 'yours', 'yourself', 'yourselves'
]);

function extractKeywords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, ' ')
    .split(/\s+/)
    .filter(t => t.length > 2 && !STOPWORDS.has(t));
}

export class SessionManager {
  private filePath: string;
  private backupPath: string;
  private data: SessionsDataSchema;
  private isSaving = false;
  private savePending = false;

  constructor(filePath?: string) {
    this.filePath = filePath || path.resolve(process.cwd(), 'data', 'sessions.json');
    this.backupPath = this.filePath.replace(/\.json$/, '.backup.json');
    this.data = {
      version: 1,
      sessions: [],
      messages: {}
    };

    this.load();
    this.ensureMigration();
  }

  private load(): void {
    try {
      if (fs.existsSync(this.filePath)) {
        const raw = fs.readFileSync(this.filePath, 'utf8');
        const parsed = JSON.parse(raw);
        this.data = {
          version: parsed.version || 1,
          sessions: Array.isArray(parsed.sessions) ? parsed.sessions : [],
          messages: typeof parsed.messages === 'object' && parsed.messages !== null ? parsed.messages : {}
        };
      } else if (fs.existsSync(this.backupPath)) {
        console.warn('[SessionManager] Primary sessions.json missing, restoring from backup...');
        const raw = fs.readFileSync(this.backupPath, 'utf8');
        const parsed = JSON.parse(raw);
        this.data = {
          version: parsed.version || 1,
          sessions: Array.isArray(parsed.sessions) ? parsed.sessions : [],
          messages: typeof parsed.messages === 'object' && parsed.messages !== null ? parsed.messages : {}
        };
        this.save();
      } else {
        this.save();
      }
    } catch (err) {
      console.error('[SessionManager] Error reading sessions file:', err);
      // Attempt recovery from backup
      try {
        if (fs.existsSync(this.backupPath)) {
          const raw = fs.readFileSync(this.backupPath, 'utf8');
          const parsed = JSON.parse(raw);
          this.data = {
            version: parsed.version || 1,
            sessions: Array.isArray(parsed.sessions) ? parsed.sessions : [],
            messages: typeof parsed.messages === 'object' && parsed.messages !== null ? parsed.messages : {}
          };
          this.save();
        }
      } catch (backupErr) {
        console.error('[SessionManager] Backup recovery failed, initializing fresh store:', backupErr);
      }
    }
  }

  private save(): void {
    if (this.isSaving) {
      this.savePending = true;
      return;
    }

    this.isSaving = true;
    try {
      const dir = path.dirname(this.filePath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

      const jsonStr = JSON.stringify(this.data, null, 2);
      const tempPath = `${this.filePath}.${Date.now()}.tmp`;

      // Atomic write: write to temp file then rename
      fs.writeFileSync(tempPath, jsonStr, 'utf8');
      fs.renameSync(tempPath, this.filePath);

      // Save a copy as backup periodically
      fs.writeFileSync(this.backupPath, jsonStr, 'utf8');
    } catch (err) {
      console.error('[SessionManager] Failed to persist sessions:', err);
    } finally {
      this.isSaving = false;
      if (this.savePending) {
        this.savePending = false;
        this.save();
      }
    }
  }

  /**
   * Idempotently migrates existing conversation history from data/memory.json
   * into a default "General Conversation" session if no sessions exist.
   */
  private ensureMigration(): void {
    if (this.data.sessions.length > 0) return;

    try {
      const memoryPath = path.resolve(process.cwd(), 'data', 'memory.json');
      let migratedMessages: ChatMessage[] = [];

      if (fs.existsSync(memoryPath)) {
        const raw = fs.readFileSync(memoryPath, 'utf8');
        const memoryData = JSON.parse(raw);
        const history = memoryData.conversationHistory;

        if (Array.isArray(history) && history.length > 0) {
          const defaultSessionId = 'session_default_general';
          migratedMessages = history.map((item, idx) => ({
            id: `msg_migrated_${idx}_${Date.now()}`,
            sessionId: defaultSessionId,
            role: (item.role === 'user' ? 'user' : 'assistant') as 'user' | 'assistant',
            content: String(item.content || ''),
            createdAt: typeof item.timestamp === 'number' ? item.timestamp : Date.now() - (history.length - idx) * 60000,
            status: 'delivered' as const
          }));

          const defaultSession: ChatSession = {
            id: defaultSessionId,
            title: 'General Conversation',
            topic: 'General Discussion & Assistant',
            summary: 'Initial conversation migrated from local history.',
            establishedFacts: [],
            createdAt: migratedMessages[0]?.createdAt || Date.now(),
            updatedAt: migratedMessages[migratedMessages.length - 1]?.createdAt || Date.now(),
            pinned: false,
            pinnedAt: null,
            archived: false,
            archivedAt: null,
            messageCount: migratedMessages.length
          };

          this.data.sessions.push(defaultSession);
          this.data.messages[defaultSessionId] = migratedMessages;
          this.save();
          console.log(`[SessionManager] Idempotently migrated ${migratedMessages.length} existing turns into "General Conversation" session.`);
          return;
        }
      }

      // If no history existed at all, create an initial default session
      const defaultSessionId = 'session_default_general';
      const defaultSession: ChatSession = {
        id: defaultSessionId,
        title: 'New Conversation',
        topic: 'General Assistant',
        summary: '',
        establishedFacts: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
        pinned: false,
        pinnedAt: null,
        archived: false,
        archivedAt: null,
        messageCount: 0
      };
      this.data.sessions.push(defaultSession);
      this.data.messages[defaultSessionId] = [];
      this.save();
    } catch (e) {
      console.warn('[SessionManager] Migration notice:', e);
    }
  }

  // ── Session CRUD Operations ─────────────────────────────────────────────

  public createSession(title?: string, topic?: string): ChatSession {
    const now = Date.now();
    const id = `session_${now}_${Math.random().toString(36).substring(2, 7)}`;
    const session: ChatSession = {
      id,
      title: title?.trim() || 'New Conversation',
      topic: topic?.trim() || 'General',
      summary: '',
      establishedFacts: [],
      createdAt: now,
      updatedAt: now,
      pinned: false,
      pinnedAt: null,
      archived: false,
      archivedAt: null,
      messageCount: 0
    };

    this.data.sessions.unshift(session);
    this.data.messages[id] = [];
    this.save();
    return session;
  }

  public listSessions(options: { includeArchived?: boolean; search?: string } = {}): ChatSession[] {
    let list = [...this.data.sessions];

    if (!options.includeArchived) {
      list = list.filter(s => !s.archived);
    }

    if (options.search?.trim()) {
      const q = options.search.trim().toLowerCase();
      list = list.filter(s => {
        const titleMatch = s.title.toLowerCase().includes(q);
        const topicMatch = s.topic.toLowerCase().includes(q);
        const summaryMatch = s.summary.toLowerCase().includes(q);
        const factsMatch = s.establishedFacts.some(f => f.toLowerCase().includes(q));
        if (titleMatch || topicMatch || summaryMatch || factsMatch) return true;

        // Search messages in session
        const msgs = this.data.messages[s.id] || [];
        return msgs.some(m => m.content.toLowerCase().includes(q));
      });
    }

    // Sort: pinned first (by pinnedAt desc), then by updatedAt desc
    list.sort((a, b) => {
      if (a.pinned && !b.pinned) return -1;
      if (!a.pinned && b.pinned) return 1;
      if (a.pinned && b.pinned) {
        return (b.pinnedAt || b.updatedAt) - (a.pinnedAt || a.updatedAt);
      }
      return b.updatedAt - a.updatedAt;
    });

    return list;
  }

  public getSession(id: string): { session: ChatSession; messages: ChatMessage[] } | null {
    const session = this.data.sessions.find(s => s.id === id);
    if (!session) return null;
    const messages = this.data.messages[id] || [];
    return { session: { ...session }, messages: [...messages] };
  }

  public updateSession(id: string, updates: Partial<ChatSession>): ChatSession | null {
    const idx = this.data.sessions.findIndex(s => s.id === id);
    if (idx === -1) return null;

    const current = this.data.sessions[idx];
    const updated: ChatSession = {
      ...current,
      ...updates,
      id: current.id, // Immutable ID
      createdAt: current.createdAt,
      updatedAt: Date.now()
    };

    // Handle pin timestamp
    if (updates.pinned !== undefined) {
      updated.pinned = Boolean(updates.pinned);
      updated.pinnedAt = updated.pinned ? (current.pinnedAt || Date.now()) : null;
    }

    // Handle archive timestamp
    if (updates.archived !== undefined) {
      updated.archived = Boolean(updates.archived);
      updated.archivedAt = updated.archived ? (current.archivedAt || Date.now()) : null;
    }

    this.data.sessions[idx] = updated;
    this.save();
    return updated;
  }

  public deleteSession(id: string): boolean {
    const initialLen = this.data.sessions.length;
    this.data.sessions = this.data.sessions.filter(s => s.id !== id);
    delete this.data.messages[id];

    if (this.data.sessions.length < initialLen) {
      // If all sessions deleted, ensure at least one default session exists
      if (this.data.sessions.length === 0) {
        this.createSession('New Conversation', 'General');
      }
      this.save();
      return true;
    }
    return false;
  }

  // ── Message Operations ──────────────────────────────────────────────────

  public addMessage(
    sessionId: string,
    role: 'user' | 'assistant' | 'system',
    content: string,
    extra: Partial<ChatMessage> = {}
  ): ChatMessage {
    let session = this.data.sessions.find(s => s.id === sessionId);
    if (!session) {
      // If session doesn't exist, auto-create it
      session = this.createSession('Conversation', 'General');
      sessionId = session.id;
    }

    const now = Date.now();
    const msg: ChatMessage = {
      id: extra.id || `msg_${now}_${Math.random().toString(36).substring(2, 7)}`,
      sessionId,
      role,
      content,
      createdAt: extra.createdAt || now,
      status: extra.status || 'delivered',
      modelUsed: extra.modelUsed,
      audioDurationMs: extra.audioDurationMs,
      interrupted: extra.interrupted,
      pending: extra.pending,
      attachment: extra.attachment
    };

    if (!this.data.messages[sessionId]) {
      this.data.messages[sessionId] = [];
    }

    this.data.messages[sessionId].push(msg);

    // Update session metadata
    session.messageCount = this.data.messages[sessionId].length;
    session.updatedAt = now;

    // Auto-derive title if this is the first turn and title is generic
    if (session.messageCount <= 2 && (session.title === 'New Conversation' || session.title === 'Conversation' || session.title.startsWith('Session '))) {
      this.autoGenerateInitialTitleAndTopic(session, content);
    }

    this.save();
    return msg;
  }

  public updateMessage(
    sessionId: string,
    messageId: string,
    updates: Partial<ChatMessage>
  ): ChatMessage | null {
    const list = this.data.messages[sessionId];
    if (!list) return null;
    const msg = list.find(m => m.id === messageId);
    if (!msg) return null;

    Object.assign(msg, updates);
    const session = this.data.sessions.find(s => s.id === sessionId);
    if (session) {
      session.updatedAt = Date.now();
    }
    this.save();
    return msg;
  }

  public getMessages(sessionId: string, limit?: number): ChatMessage[] {
    const list = this.data.messages[sessionId] || [];
    if (typeof limit === 'number' && limit > 0) {
      return list.slice(-limit);
    }
    return [...list];
  }

  // ── Topic-Aware Context Retrieval ───────────────────────────────────────

  /**
   * Retrieves relevant older messages from the active session matching the query.
   * Excludes the most recent `excludeRecent` messages to avoid prompt redundancy.
   */
  public retrieveRelevantMessages(
    sessionId: string,
    query: string,
    limit = 4,
    excludeRecent = 8
  ): ChatMessage[] {
    const all = this.data.messages[sessionId] || [];
    if (all.length <= excludeRecent) {
      return [];
    }

    // Search pool: all messages except the recent sliding window
    const pool = all.slice(0, all.length - excludeRecent);
    const queryTokens = extractKeywords(query);

    if (queryTokens.length === 0) return [];

    const scored = pool.map(msg => {
      const msgTokens = extractKeywords(msg.content);
      const tokenSet = new Set(msgTokens);

      let score = 0;
      for (const qt of queryTokens) {
        if (tokenSet.has(qt)) score += 3;
        // Prefix matching
        else if (msgTokens.some(mt => mt.startsWith(qt) || qt.startsWith(mt))) score += 1;
      }

      // Exact phrase match bonus
      if (msg.content.toLowerCase().includes(query.toLowerCase())) {
        score += 8;
      }

      return { msg, score };
    });

    return scored
      .filter(item => item.score > 2)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map(item => item.msg);
  }

  /**
   * Quick heuristic title & topic generator for the opening conversation turn.
   */
  private autoGenerateInitialTitleAndTopic(session: ChatSession, firstUserPrompt: string): void {
    const cleaned = firstUserPrompt
      .replace(/^(can you|could you|please|help me|tell me|what is|how do i|how to|i want to|i need to|let's talk about|explain)\s+/i, '')
      .replace(/[?!.]+$/, '')
      .trim();

    if (!cleaned) return;

    // Generate concise title (up to 40 chars)
    const words = cleaned.split(/\s+/);
    let title = words.slice(0, 5).join(' ');
    title = title.charAt(0).toUpperCase() + title.slice(1);
    if (title.length > 38) title = title.substring(0, 35) + '...';

    // Auto-detect broad topic
    const lower = cleaned.toLowerCase();
    let topic = 'General';

    if (lower.includes('code') || lower.includes('python') || lower.includes('react') || lower.includes('typescript') || lower.includes('bug') || lower.includes('function') || lower.includes('api')) {
      topic = 'Software Engineering';
    } else if (lower.includes('weather') || lower.includes('forecast') || lower.includes('rain') || lower.includes('temperature')) {
      topic = 'Weather & Environment';
    } else if (lower.includes('interview') || lower.includes('resume') || lower.includes('job') || lower.includes('career')) {
      topic = 'Career & Interview Prep';
    } else if (lower.includes('study') || lower.includes('math') || lower.includes('physics') || lower.includes('science') || lower.includes('history')) {
      topic = 'Education & Learning';
    } else if (lower.includes('movie') || lower.includes('music') || lower.includes('game') || lower.includes('book') || lower.includes('story')) {
      topic = 'Arts & Entertainment';
    } else if (lower.includes('travel') || lower.includes('trip') || lower.includes('flight') || lower.includes('hotel') || lower.includes('city')) {
      topic = 'Travel & Exploration';
    } else if (lower.includes('health') || lower.includes('workout') || lower.includes('diet') || lower.includes('fitness')) {
      topic = 'Health & Fitness';
    } else if (lower.includes('avatar') || lower.includes('3d') || lower.includes('model') || lower.includes('animation') || lower.includes('studio')) {
      topic = '3D Avatar & Studio';
    } else {
      topic = title.length > 25 ? title.split(' ').slice(0, 2).join(' ') : title;
    }

    session.title = title;
    session.topic = topic;
  }

  /**
   * Updates rolling summary and key facts for a session.
   */
  public updateRollingSummary(
    sessionId: string,
    summary: string,
    establishedFacts?: string[],
    refinedTopic?: string
  ): void {
    const session = this.data.sessions.find(s => s.id === sessionId);
    if (!session) return;

    if (summary) session.summary = summary;
    if (Array.isArray(establishedFacts)) {
      // Merge unique facts
      const set = new Set([...session.establishedFacts, ...establishedFacts]);
      session.establishedFacts = Array.from(set).slice(0, 15);
    }
    if (refinedTopic && refinedTopic.trim()) {
      session.topic = refinedTopic.trim();
    }
    session.updatedAt = Date.now();
    this.save();
  }

  /**
   * Search across all sessions by title, topic, or message contents.
   */
  public search(query: string): Array<{ session: ChatSession; matchingMessages: ChatMessage[] }> {
    const q = query.trim().toLowerCase();
    if (!q) return [];

    const results: Array<{ session: ChatSession; matchingMessages: ChatMessage[] }> = [];

    for (const session of this.data.sessions) {
      const titleMatch = session.title.toLowerCase().includes(q);
      const topicMatch = session.topic.toLowerCase().includes(q);
      const summaryMatch = session.summary.toLowerCase().includes(q);
      const msgs = this.data.messages[session.id] || [];
      const matchingMessages = msgs.filter(m => m.content.toLowerCase().includes(q));

      if (titleMatch || topicMatch || summaryMatch || matchingMessages.length > 0) {
        results.push({
          session: { ...session },
          matchingMessages: matchingMessages.slice(0, 5)
        });
      }
    }

    return results;
  }
}

