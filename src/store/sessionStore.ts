import { create } from 'zustand';
import { ChatSession, ChatMessage, GroupedSessions } from '@/types/session';
import {
  fetchSessions,
  createSession as apiCreateSession,
  getSession as apiGetSession,
  updateSession as apiUpdateSession,
  deleteSession as apiDeleteSession,
  triggerSessionSummarize
} from '@/services/sessionService';

const ACTIVE_SESSION_STORAGE_KEY = 'talking_character_active_session_id';

interface SessionStoreState {
  sessions: ChatSession[];
  activeSessionId: string | null;
  activeMessages: ChatMessage[];
  isLoadingSessions: boolean;
  isLoadingMessages: boolean;
  sessionSearchQuery: string;
  showArchived: boolean;
  error: string | null;
  deletingSession: ChatSession | null;
  isMemoryInspectorOpen: boolean;

  // Actions
  loadSessions: () => Promise<void>;
  selectSession: (id: string) => Promise<void>;
  createNewSession: (title?: string, topic?: string) => Promise<ChatSession>;
  renameSession: (id: string, newTitle: string) => Promise<void>;
  updateTopic: (id: string, newTopic: string) => Promise<void>;
  togglePinSession: (id: string) => Promise<void>;
  toggleArchiveSession: (id: string) => Promise<void>;
  confirmDeleteSession: (id: string) => Promise<boolean>;
  setSessionSearchQuery: (query: string) => void;
  setShowArchived: (show: boolean) => void;
  setDeletingSession: (session: ChatSession | null) => void;
  setIsMemoryInspectorOpen: (open: boolean) => void;
  appendLocalMessage: (message: ChatMessage) => void;
  updateSessionMeta: (id: string, meta: Partial<ChatSession>) => void;
  triggerSummarize: (id?: string) => Promise<void>;
  getGroupedSessions: () => GroupedSessions;
  getActiveSession: () => ChatSession | null;
}

export const useSessionStore = create<SessionStoreState>((set, get) => ({
  sessions: [],
  activeSessionId: null,
  activeMessages: [],
  isLoadingSessions: false,
  isLoadingMessages: false,
  sessionSearchQuery: '',
  showArchived: false,
  error: null,
  deletingSession: null,
  isMemoryInspectorOpen: false,

  loadSessions: async () => {
    set({ isLoadingSessions: true, error: null });
    try {
      const list = await fetchSessions(true);
      set({ sessions: list });

      const state = get();
      const savedSessionId = typeof window !== 'undefined'
        ? localStorage.getItem(ACTIVE_SESSION_STORAGE_KEY)
        : null;

      // 1. Check if the saved session still exists and is not archived
      const validSaved = savedSessionId ? list.find(s => s.id === savedSessionId && !s.archived) : null;

      if (validSaved) {
        await state.selectSession(validSaved.id);
      } else if (!state.activeSessionId || !list.some(s => s.id === state.activeSessionId && !s.archived)) {
        // 2. Fall back to the most recently updated unarchived session
        const unarchived = list.filter(s => !s.archived).sort((a, b) => b.updatedAt - a.updatedAt);
        const mostRecent = unarchived[0];
        if (mostRecent) {
          await state.selectSession(mostRecent.id);
        } else if (list.length > 0) {
          await state.selectSession(list[0].id);
        } else {
          const fresh = await state.createNewSession('New Conversation', 'General');
          await state.selectSession(fresh.id);
        }
      }
    } catch (err: any) {
      console.error('[SessionStore] loadSessions error:', err);
      set({ error: err?.message || 'Could not load sessions' });
    } finally {
      set({ isLoadingSessions: false });
    }
  },

  selectSession: async (id: string) => {
    const currentActive = get().activeSessionId;
    if (currentActive === id && get().activeMessages.length > 0) return;

    // Immediately persist active session ID to localStorage
    if (typeof window !== 'undefined') {
      try {
        localStorage.setItem(ACTIVE_SESSION_STORAGE_KEY, id);
      } catch (e) {
        console.warn('[SessionStore] Failed to write activeSessionId to localStorage', e);
      }
    }

    // Immediately stop any existing speaking or voice playback from the old session
    window.dispatchEvent(new CustomEvent('session-switch', { detail: { newSessionId: id, oldSessionId: currentActive } }));

    set({ activeSessionId: id, isLoadingMessages: true, error: null });
    try {
      const data = await apiGetSession(id);
      set({
        activeMessages: data.messages || [],
        // Update session in list if updated
        sessions: get().sessions.map(s => s.id === id ? data.session : s)
      });
    } catch (err: any) {
      console.error('[SessionStore] selectSession error:', err);
      set({ error: err?.message || 'Failed to open session' });
    } finally {
      set({ isLoadingMessages: false });
    }
  },

  createNewSession: async (title?: string, topic?: string) => {
    set({ isLoadingSessions: true, error: null });
    try {
      const created = await apiCreateSession(title, topic);
      set((state) => ({
        sessions: [created, ...state.sessions.filter(s => s.id !== created.id)]
      }));
      await get().selectSession(created.id);
      return created;
    } catch (err: any) {
      console.error('[SessionStore] createNewSession error:', err);
      set({ error: err?.message || 'Failed to create session' });
      throw err;
    } finally {
      set({ isLoadingSessions: false });
    }
  },

  renameSession: async (id: string, newTitle: string) => {
    const trimmed = newTitle.trim();
    if (!trimmed) return;

    // Optimistic update
    set((state) => ({
      sessions: state.sessions.map(s => s.id === id ? { ...s, title: trimmed } : s)
    }));

    try {
      const updated = await apiUpdateSession(id, { title: trimmed });
      set((state) => ({
        sessions: state.sessions.map(s => s.id === id ? updated : s)
      }));
    } catch (err: any) {
      console.error('[SessionStore] renameSession error:', err);
      set({ error: err?.message || 'Failed to rename session' });
    }
  },

  updateTopic: async (id: string, newTopic: string) => {
    const trimmed = newTopic.trim();
    if (!trimmed) return;

    // Optimistic update
    set((state) => ({
      sessions: state.sessions.map(s => s.id === id ? { ...s, topic: trimmed } : s)
    }));

    try {
      const updated = await apiUpdateSession(id, { topic: trimmed });
      set((state) => ({
        sessions: state.sessions.map(s => s.id === id ? updated : s)
      }));
    } catch (err: any) {
      console.error('[SessionStore] updateTopic error:', err);
      set({ error: err?.message || 'Failed to update topic' });
    }
  },

  togglePinSession: async (id: string) => {
    const session = get().sessions.find(s => s.id === id);
    if (!session) return;
    const nextPinned = !session.pinned;

    // Optimistic update
    set((state) => ({
      sessions: state.sessions.map(s => s.id === id ? { ...s, pinned: nextPinned, pinnedAt: nextPinned ? Date.now() : null } : s)
    }));

    try {
      const updated = await apiUpdateSession(id, { pinned: nextPinned });
      set((state) => ({
        sessions: state.sessions.map(s => s.id === id ? updated : s)
      }));
    } catch (err: any) {
      console.error('[SessionStore] togglePin error:', err);
    }
  },

  toggleArchiveSession: async (id: string) => {
    const session = get().sessions.find(s => s.id === id);
    if (!session) return;
    const nextArchived = !session.archived;

    // Optimistic update
    set((state) => ({
      sessions: state.sessions.map(s => s.id === id ? { ...s, archived: nextArchived, archivedAt: nextArchived ? Date.now() : null } : s)
    }));

    try {
      const updated = await apiUpdateSession(id, { archived: nextArchived });
      set((state) => ({
        sessions: state.sessions.map(s => s.id === id ? updated : s)
      }));

      // If active session was archived and showArchived is false, switch to next unarchived
      if (get().activeSessionId === id && nextArchived && !get().showArchived) {
        const next = get().sessions.find(s => !s.archived && s.id !== id);
        if (next) {
          await get().selectSession(next.id);
        }
      }
    } catch (err: any) {
      console.error('[SessionStore] toggleArchive error:', err);
    }
  },

  confirmDeleteSession: async (id: string) => {
    try {
      await apiDeleteSession(id);
      const remaining = get().sessions.filter(s => s.id !== id);
      set({
        sessions: remaining,
        deletingSession: null
      });

      // If we just deleted the active session, clear localStorage and pick next
      if (get().activeSessionId === id) {
        if (typeof window !== 'undefined') {
          try {
            localStorage.removeItem(ACTIVE_SESSION_STORAGE_KEY);
          } catch {}
        }
        const next = remaining.find(s => !s.archived) || remaining[0];
        if (next) {
          await get().selectSession(next.id);
        } else {
          const fresh = await get().createNewSession('New Conversation', 'General');
          await get().selectSession(fresh.id);
        }
      }
      return true;
    } catch (err: any) {
      console.error('[SessionStore] confirmDeleteSession error:', err);
      set({ error: err?.message || 'Failed to delete session' });
      return false;
    }
  },

  setSessionSearchQuery: (sessionSearchQuery: string) => set({ sessionSearchQuery }),
  setShowArchived: (showArchived: boolean) => set({ showArchived }),
  setDeletingSession: (deletingSession: ChatSession | null) => set({ deletingSession }),
  setIsMemoryInspectorOpen: (isMemoryInspectorOpen: boolean) => set({ isMemoryInspectorOpen }),

  appendLocalMessage: (message: ChatMessage) => {
    set((state) => {
      const isForActive = state.activeSessionId === message.sessionId;
      const updatedActiveMessages = isForActive
        ? (state.activeMessages.some(m => m.id === message.id)
            ? state.activeMessages.map(m => m.id === message.id ? message : m)
            : [...state.activeMessages, message])
        : state.activeMessages;

      // Update message count and updatedAt on the target session in sessions list
      const updatedSessions = state.sessions.map(s => {
        if (s.id === message.sessionId) {
          const nextCount = isForActive ? updatedActiveMessages.length : (s.messageCount + 1);
          return { ...s, messageCount: nextCount, updatedAt: message.createdAt };
        }
        return s;
      });

      return {
        activeMessages: updatedActiveMessages,
        sessions: updatedSessions
      };
    });
  },

  updateSessionMeta: (id: string, meta: Partial<ChatSession>) => {
    set((state) => ({
      sessions: state.sessions.map(s => s.id === id ? { ...s, ...meta } : s)
    }));
  },

  triggerSummarize: async (id?: string) => {
    const targetId = id || get().activeSessionId;
    if (!targetId) return;
    try {
      const updated = await triggerSessionSummarize(targetId);
      if (updated) {
        set((state) => ({
          sessions: state.sessions.map(s => s.id === targetId ? updated : s)
        }));
      }
    } catch (e) {
      console.warn('[SessionStore] triggerSummarize notice:', e);
    }
  },

  getActiveSession: () => {
    const state = get();
    return state.sessions.find(s => s.id === state.activeSessionId) || null;
  },

  getGroupedSessions: () => {
    const { sessions, sessionSearchQuery, showArchived } = get();
    const query = sessionSearchQuery.trim().toLowerCase();

    // Filter
    let filtered = [...sessions];
    if (query) {
      filtered = filtered.filter(s =>
        s.title.toLowerCase().includes(query) ||
        s.topic.toLowerCase().includes(query) ||
        s.summary.toLowerCase().includes(query)
      );
    }

    const now = Date.now();
    const startOfToday = new Date().setHours(0, 0, 0, 0);
    const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000;

    const grouped: GroupedSessions = {
      pinned: [],
      today: [],
      previous7Days: [],
      older: [],
      archived: []
    };

    for (const session of filtered) {
      if (session.archived) {
        if (showArchived || query) {
          grouped.archived.push(session);
        }
        continue;
      }

      if (session.pinned) {
        grouped.pinned.push(session);
        continue;
      }

      const updated = session.updatedAt || session.createdAt;
      if (updated >= startOfToday) {
        grouped.today.push(session);
      } else if (updated >= sevenDaysAgo) {
        grouped.previous7Days.push(session);
      } else {
        grouped.older.push(session);
      }
    }

    return grouped;
  }
}));

