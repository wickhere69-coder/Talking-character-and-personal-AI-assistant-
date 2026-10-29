import { ChatSession, ChatMessage } from '@/types/session';

// ── Client-Side IndexedDB Storage Helper ──────────────────────────────────
const DB_NAME = 'talking_character_db';
const DB_VERSION = 1;

class SessionIndexedDB {
  private dbPromise: Promise<IDBDatabase> | null = null;

  private getDB(): Promise<IDBDatabase> {
    if (this.dbPromise) return this.dbPromise;

    this.dbPromise = new Promise((resolve, reject) => {
      if (typeof window === 'undefined' || !window.indexedDB) {
        return reject(new Error('IndexedDB not supported in this environment'));
      }

      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = (e: IDBVersionChangeEvent) => {
        const db = (e.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains('sessions')) {
          db.createObjectStore('sessions', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('messages')) {
          const msgStore = db.createObjectStore('messages', { keyPath: 'id' });
          msgStore.createIndex('sessionId', 'sessionId', { unique: false });
        }
      };

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });

    return this.dbPromise;
  }

  async saveSessions(sessions: ChatSession[]): Promise<void> {
    try {
      const db = await this.getDB();
      const tx = db.transaction('sessions', 'readwrite');
      const store = tx.objectStore('sessions');
      for (const s of sessions) {
        store.put(s);
      }
    } catch (e) {
      console.warn('[IDB] saveSessions notice:', e);
    }
  }

  async getCachedSessions(): Promise<ChatSession[]> {
    try {
      const db = await this.getDB();
      return new Promise((resolve) => {
        const tx = db.transaction('sessions', 'readonly');
        const store = tx.objectStore('sessions');
        const req = store.getAll();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => resolve([]);
      });
    } catch {
      return [];
    }
  }

  async saveMessages(messages: ChatMessage[]): Promise<void> {
    try {
      const db = await this.getDB();
      const tx = db.transaction('messages', 'readwrite');
      const store = tx.objectStore('messages');
      for (const m of messages) {
        store.put(m);
      }
    } catch (e) {
      console.warn('[IDB] saveMessages notice:', e);
    }
  }

  async getCachedMessages(sessionId: string): Promise<ChatMessage[]> {
    try {
      const db = await this.getDB();
      return new Promise((resolve) => {
        const tx = db.transaction('messages', 'readonly');
        const store = tx.objectStore('messages');
        const index = store.index('sessionId');
        const req = index.getAll(IDBKeyRange.only(sessionId));
        req.onsuccess = () => {
          const list: ChatMessage[] = req.result || [];
          list.sort((a, b) => a.createdAt - b.createdAt);
          resolve(list);
        };
        req.onerror = () => resolve([]);
      });
    } catch {
      return [];
    }
  }

  async deleteSession(sessionId: string): Promise<void> {
    try {
      const db = await this.getDB();
      const tx = db.transaction(['sessions', 'messages'], 'readwrite');
      tx.objectStore('sessions').delete(sessionId);

      const msgStore = tx.objectStore('messages');
      const index = msgStore.index('sessionId');
      const req = index.openCursor(IDBKeyRange.only(sessionId));
      req.onsuccess = () => {
        const cursor = req.result;
        if (cursor) {
          cursor.delete();
          cursor.continue();
        }
      };
    } catch (e) {
      console.warn('[IDB] deleteSession notice:', e);
    }
  }
}

export const sessionIDB = new SessionIndexedDB();

// ── REST API Client with Offline Resilience ───────────────────────────────

export async function fetchSessions(includeArchived = false, search?: string): Promise<ChatSession[]> {
  try {
    const params = new URLSearchParams();
    if (includeArchived) params.set('includeArchived', 'true');
    if (search?.trim()) params.set('search', search.trim());

    const res = await fetch(`/api/agent/sessions?${params.toString()}`);
    if (!res.ok) {
      throw new Error(`Failed to fetch sessions (${res.status})`);
    }

    const data = await res.json();
    const sessions: ChatSession[] = data.sessions || [];

    // Cache in IndexedDB in the background
    sessionIDB.saveSessions(sessions).catch(() => {});
    return sessions;
  } catch (err) {
    console.warn('[SessionService] Server unreachable, loading from local cache:', err);
    // Fall back to local IndexedDB
    const cached = await sessionIDB.getCachedSessions();
    if (cached.length > 0) {
      return includeArchived ? cached : cached.filter(s => !s.archived);
    }
    throw err;
  }
}

export async function createSession(title?: string, topic?: string): Promise<ChatSession> {
  const res = await fetch('/api/agent/sessions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title, topic })
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Failed to create session (${res.status})`);
  }

  const data = await res.json();
  const session: ChatSession = data.session;
  sessionIDB.saveSessions([session]).catch(() => {});
  return session;
}

export async function getSession(id: string): Promise<{ session: ChatSession; messages: ChatMessage[] }> {
  try {
    const res = await fetch(`/api/agent/sessions/${encodeURIComponent(id)}`);
    if (!res.ok) {
      throw new Error(`Failed to get session (${res.status})`);
    }

    const data = await res.json();
    sessionIDB.saveSessions([data.session]).catch(() => {});
    sessionIDB.saveMessages(data.messages).catch(() => {});
    return data;
  } catch (err) {
    console.warn(`[SessionService] Notice fetching session ${id}, checking cache:`, err);
    const cachedMsgs = await sessionIDB.getCachedMessages(id);
    const cachedSessions = await sessionIDB.getCachedSessions();
    const match = cachedSessions.find(s => s.id === id);
    if (match) {
      return { session: match, messages: cachedMsgs };
    }
    throw err;
  }
}

export async function updateSession(id: string, updates: Partial<ChatSession>): Promise<ChatSession> {
  const res = await fetch(`/api/agent/sessions/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(updates)
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Failed to update session (${res.status})`);
  }

  const data = await res.json();
  sessionIDB.saveSessions([data.session]).catch(() => {});
  return data.session;
}

export async function deleteSession(id: string): Promise<boolean> {
  const res = await fetch(`/api/agent/sessions/${encodeURIComponent(id)}`, {
    method: 'DELETE'
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Failed to delete session (${res.status})`);
  }

  sessionIDB.deleteSession(id).catch(() => {});
  return true;
}

export async function searchSessions(query: string): Promise<Array<{ session: ChatSession; matchingMessages: ChatMessage[] }>> {
  const res = await fetch(`/api/agent/sessions/search?q=${encodeURIComponent(query)}`);
  if (!res.ok) {
    throw new Error('Failed to search sessions');
  }
  const data = await res.json();
  return data.results || [];
}

export async function triggerSessionSummarize(id: string): Promise<ChatSession | null> {
  try {
    const res = await fetch(`/api/agent/sessions/${encodeURIComponent(id)}/summarize`, {
      method: 'POST'
    });
    if (res.ok) {
      const data = await res.json();
      if (data.session) {
        sessionIDB.saveSessions([data.session]).catch(() => {});
        return data.session;
      }
    }
  } catch {}
  return null;
}

