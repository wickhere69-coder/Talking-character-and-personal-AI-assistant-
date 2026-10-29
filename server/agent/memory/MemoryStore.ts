import fs from 'fs';
import path from 'path';
import { MemoryItem, TaskItem, NoteItem, ReminderItem } from '../types';
import { getSupabaseClient, isSupabaseConfigured } from '../../db/supabaseClient';

export interface MemorySchema {
  memories: MemoryItem[];
  tasks: TaskItem[];
  notes: NoteItem[];
  reminders: ReminderItem[];
  userPreferences: Record<string, string>;
  conversationHistory: Array<{ role: string; content: string; timestamp: number }>;
}

export class MemoryStore {
  private filePath: string;
  private data: MemorySchema;
  private isSupabaseSyncing: boolean = false;

  constructor(filePath?: string) {
    this.filePath = filePath || path.resolve(process.cwd(), 'data', 'memory.json');
    this.data = {
      memories: [],
      tasks: [],
      notes: [],
      reminders: [],
      userPreferences: {},
      conversationHistory: []
    };
    this.load();

    // If Supabase is configured, trigger initial background sync
    if (isSupabaseConfigured()) {
      this.syncFromSupabase().catch((err) => {
        console.warn('Initial Supabase sync notice:', err?.message || err);
      });
    }
  }

  private load(): void {
    try {
      if (fs.existsSync(this.filePath)) {
        const raw = fs.readFileSync(this.filePath, 'utf8');
        const parsed = JSON.parse(raw);
        this.data = {
          memories: parsed.memories || [],
          tasks: parsed.tasks || [],
          notes: parsed.notes || [],
          reminders: parsed.reminders || [],
          userPreferences: parsed.userPreferences || {},
          conversationHistory: parsed.conversationHistory || []
        };
      } else {
        this.save();
      }
    } catch (e) {
      console.warn('Notice loading memory.json, initializing fresh store:', e);
      this.save();
    }
  }

  private save(): void {
    try {
      const dir = path.dirname(this.filePath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(this.filePath, JSON.stringify(this.data, null, 2), 'utf8');
    } catch (e) {
      console.error('Failed to save memory.json:', e);
    }
  }

  // ── Supabase Cloud Database Synchronization ──
  public async syncFromSupabase(): Promise<{ success: boolean; counts?: Record<string, number>; error?: string }> {
    const supabase = getSupabaseClient();
    if (!supabase) return { success: false, error: 'Supabase client not configured' };

    this.isSupabaseSyncing = true;
    try {
      const [memRes, taskRes, noteRes, remRes, convRes] = await Promise.allSettled([
        supabase.from('memories').select('*'),
        supabase.from('tasks').select('*'),
        supabase.from('notes').select('*'),
        supabase.from('reminders').select('*'),
        supabase.from('conversations').select('*').order('created_at', { ascending: false }).limit(50)
      ]);

      let importedMemories = 0;
      let importedTasks = 0;
      let importedNotes = 0;
      let importedReminders = 0;

      // Merge Memories
      if (memRes.status === 'fulfilled' && memRes.value.data && !memRes.value.error) {
        for (const row of memRes.value.data) {
          const item: MemoryItem = {
            id: row.id,
            key: row.key,
            value: row.value,
            category: row.category || 'fact',
            createdAt: row.created_at ? new Date(row.created_at).getTime() : Date.now(),
            updatedAt: row.updated_at ? new Date(row.updated_at).getTime() : Date.now()
          };
          const existingIdx = this.data.memories.findIndex(m => m.id === item.id || m.key.toLowerCase() === item.key.toLowerCase());
          if (existingIdx >= 0) {
            this.data.memories[existingIdx] = item;
          } else {
            this.data.memories.push(item);
          }
          if (item.category === 'preference') {
            this.data.userPreferences[item.key] = item.value;
          }
          importedMemories++;
        }
      }

      // Merge Tasks
      if (taskRes.status === 'fulfilled' && taskRes.value.data && !taskRes.value.error) {
        for (const row of taskRes.value.data) {
          const task: TaskItem = {
            id: row.id,
            title: row.title,
            status: row.status || 'pending',
            priority: row.priority || 'medium',
            dueDate: row.due_date || undefined,
            createdAt: row.created_at ? new Date(row.created_at).getTime() : Date.now()
          };
          const existingIdx = this.data.tasks.findIndex(t => t.id === task.id);
          if (existingIdx >= 0) {
            this.data.tasks[existingIdx] = task;
          } else {
            this.data.tasks.push(task);
          }
          importedTasks++;
        }
      }

      // Merge Notes
      if (noteRes.status === 'fulfilled' && noteRes.value.data && !noteRes.value.error) {
        for (const row of noteRes.value.data) {
          const note: NoteItem = {
            id: row.id,
            title: row.title,
            content: row.content,
            tags: row.tags || [],
            createdAt: row.created_at ? new Date(row.created_at).getTime() : Date.now()
          };
          const existingIdx = this.data.notes.findIndex(n => n.id === note.id);
          if (existingIdx >= 0) {
            this.data.notes[existingIdx] = note;
          } else {
            this.data.notes.push(note);
          }
          importedNotes++;
        }
      }

      // Merge Reminders
      if (remRes.status === 'fulfilled' && remRes.value.data && !remRes.value.error) {
        for (const row of remRes.value.data) {
          const reminder: ReminderItem = {
            id: row.id,
            title: row.title,
            remindAt: row.remind_at,
            triggered: Boolean(row.triggered),
            createdAt: row.created_at ? new Date(row.created_at).getTime() : Date.now()
          };
          const existingIdx = this.data.reminders.findIndex(r => r.id === reminder.id);
          if (existingIdx >= 0) {
            this.data.reminders[existingIdx] = reminder;
          } else {
            this.data.reminders.push(reminder);
          }
          importedReminders++;
        }
      }

      // Merge Conversations
      if (convRes.status === 'fulfilled' && convRes.value.data && !convRes.value.error) {
        const rows = convRes.value.data.reverse();
        for (const row of rows) {
          const exists = this.data.conversationHistory.some(
            c => c.content === row.content && Math.abs(c.timestamp - new Date(row.created_at).getTime()) < 5000
          );
          if (!exists) {
            this.data.conversationHistory.push({
              role: row.role,
              content: row.content,
              timestamp: new Date(row.created_at).getTime()
            });
          }
        }
        if (this.data.conversationHistory.length > 50) {
          this.data.conversationHistory = this.data.conversationHistory.slice(-50);
        }
      }

      this.save();
      return {
        success: true,
        counts: {
          memories: importedMemories,
          tasks: importedTasks,
          notes: importedNotes,
          reminders: importedReminders
        }
      };
    } catch (err: any) {
      console.warn('Failed to sync from Supabase:', err.message);
      return { success: false, error: err.message };
    } finally {
      this.isSupabaseSyncing = false;
    }
  }

  public async syncAllToSupabase(): Promise<{ success: boolean; synced: Record<string, number>; errors: string[] }> {
    const supabase = getSupabaseClient();
    if (!supabase) return { success: false, synced: {}, errors: ['Supabase client not configured'] };

    const errors: string[] = [];
    const synced = { memories: 0, tasks: 0, notes: 0, reminders: 0, conversations: 0 };

    // 1. Sync Memories
    if (this.data.memories.length > 0) {
      try {
        const rows = this.data.memories.map(m => ({
          id: m.id,
          key: m.key,
          value: m.value,
          category: m.category,
          updated_at: new Date(m.updatedAt || Date.now()).toISOString()
        }));
        const { error } = await supabase.from('memories').upsert(rows, { onConflict: 'id' });
        if (error) errors.push(`Memories: ${error.message}`);
        else synced.memories = rows.length;
      } catch (e: any) {
        errors.push(`Memories: ${e.message}`);
      }
    }

    // 2. Sync Tasks
    if (this.data.tasks.length > 0) {
      try {
        const rows = this.data.tasks.map(t => ({
          id: t.id,
          title: t.title,
          status: t.status,
          priority: t.priority,
          due_date: t.dueDate || null,
          created_at: new Date(t.createdAt).toISOString()
        }));
        const { error } = await supabase.from('tasks').upsert(rows, { onConflict: 'id' });
        if (error) errors.push(`Tasks: ${error.message}`);
        else synced.tasks = rows.length;
      } catch (e: any) {
        errors.push(`Tasks: ${e.message}`);
      }
    }

    // 3. Sync Notes
    if (this.data.notes.length > 0) {
      try {
        const rows = this.data.notes.map(n => ({
          id: n.id,
          title: n.title,
          content: n.content,
          tags: n.tags || [],
          created_at: new Date(n.createdAt).toISOString()
        }));
        const { error } = await supabase.from('notes').upsert(rows, { onConflict: 'id' });
        if (error) errors.push(`Notes: ${error.message}`);
        else synced.notes = rows.length;
      } catch (e: any) {
        errors.push(`Notes: ${e.message}`);
      }
    }

    // 4. Sync Reminders
    if (this.data.reminders.length > 0) {
      try {
        const rows = this.data.reminders.map(r => ({
          id: r.id,
          title: r.title,
          remind_at: r.remindAt,
          triggered: r.triggered,
          created_at: new Date(r.createdAt).toISOString()
        }));
        const { error } = await supabase.from('reminders').upsert(rows, { onConflict: 'id' });
        if (error) errors.push(`Reminders: ${error.message}`);
        else synced.reminders = rows.length;
      } catch (e: any) {
        errors.push(`Reminders: ${e.message}`);
      }
    }

    // 5. Sync Recent Conversations
    if (this.data.conversationHistory.length > 0) {
      try {
        const rows = this.data.conversationHistory.slice(-25).map(c => ({
          role: c.role,
          content: c.content,
          created_at: new Date(c.timestamp).toISOString()
        }));
        const { error } = await supabase.from('conversations').insert(rows);
        if (error) errors.push(`Conversations: ${error.message}`);
        else synced.conversations = rows.length;
      } catch (e: any) {
        errors.push(`Conversations: ${e.message}`);
      }
    }

    return {
      success: errors.length === 0,
      synced,
      errors
    };
  }

  // ── Memories (Facts / Preferences) ──
  remember(key: string, value: string, category: MemoryItem['category'] = 'fact'): MemoryItem {
    const existingIdx = this.data.memories.findIndex((m) => m.key.toLowerCase() === key.toLowerCase());
    const now = Date.now();

    let item: MemoryItem;
    if (existingIdx >= 0) {
      item = {
        ...this.data.memories[existingIdx],
        value,
        category,
        updatedAt: now
      };
      this.data.memories[existingIdx] = item;
    } else {
      item = {
        id: `mem_${now}_${Math.random().toString(36).substring(2, 6)}`,
        key,
        value,
        category,
        createdAt: now,
        updatedAt: now
      };
      this.data.memories.push(item);
    }

    if (category === 'preference') {
      this.data.userPreferences[key] = value;
    }

    this.save();

    // Async push to Supabase in background
    const supabase = getSupabaseClient();
    if (supabase) {
      supabase.from('memories').upsert({
        id: item.id,
        key: item.key,
        value: item.value,
        category: item.category,
        updated_at: new Date(now).toISOString()
      }).then(({ error }) => {
        if (error) console.warn('Supabase memory sync error:', error.message);
      }).catch(() => {});
    }

    return item;
  }

  recall(query: string): MemoryItem[] {
    const q = query.toLowerCase();
    return this.data.memories.filter(
      (m) =>
        m.key.toLowerCase().includes(q) ||
        m.value.toLowerCase().includes(q) ||
        q.includes(m.key.toLowerCase()) ||
        (m.category && q.includes(m.category))
    );
  }

  getAllMemories(): MemoryItem[] {
    return this.data.memories;
  }

  // ── Tasks ──
  addTask(title: string, priority: TaskItem['priority'] = 'medium', dueDate?: string): TaskItem {
    const task: TaskItem = {
      id: `task_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      title,
      status: 'pending',
      priority,
      dueDate,
      createdAt: Date.now()
    };
    this.data.tasks.push(task);
    this.save();

    const supabase = getSupabaseClient();
    if (supabase) {
      supabase.from('tasks').insert({
        id: task.id,
        title: task.title,
        status: task.status,
        priority: task.priority,
        due_date: task.dueDate || null,
        created_at: new Date(task.createdAt).toISOString()
      }).then(({ error }) => {
        if (error) console.warn('Supabase task insert error:', error.message);
      }).catch(() => {});
    }

    return task;
  }

  listTasks(status?: 'pending' | 'completed'): TaskItem[] {
    if (!status) return this.data.tasks;
    return this.data.tasks.filter((t) => t.status === status);
  }

  completeTask(identifier: string): boolean {
    const id = identifier.toLowerCase();
    const task = this.data.tasks.find(
      (t) => t.id.toLowerCase() === id || t.title.toLowerCase().includes(id)
    );
    if (task) {
      task.status = 'completed';
      this.save();

      const supabase = getSupabaseClient();
      if (supabase) {
        supabase.from('tasks').update({
          status: 'completed',
          completed_at: new Date().toISOString()
        }).eq('id', task.id).then(({ error }) => {
          if (error) console.warn('Supabase task complete error:', error.message);
        }).catch(() => {});
      }

      return true;
    }
    return false;
  }

  // ── Notes ──
  addNote(title: string, content: string, tags: string[] = []): NoteItem {
    const note: NoteItem = {
      id: `note_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      title,
      content,
      tags,
      createdAt: Date.now()
    };
    this.data.notes.push(note);
    this.save();

    const supabase = getSupabaseClient();
    if (supabase) {
      supabase.from('notes').insert({
        id: note.id,
        title: note.title,
        content: note.content,
        tags: note.tags,
        created_at: new Date(note.createdAt).toISOString()
      }).then(({ error }) => {
        if (error) console.warn('Supabase note insert error:', error.message);
      }).catch(() => {});
    }

    return note;
  }

  listNotes(tag?: string): NoteItem[] {
    if (!tag) return this.data.notes;
    const t = tag.toLowerCase();
    return this.data.notes.filter(
      (n) => n.tags.some((item) => item.toLowerCase().includes(t)) || n.title.toLowerCase().includes(t)
    );
  }

  deleteNote(titleOrId: string): boolean {
    const q = titleOrId.toLowerCase();
    const target = this.data.notes.find(n => n.id.toLowerCase() === q || n.title.toLowerCase() === q);
    const initialLen = this.data.notes.length;
    this.data.notes = this.data.notes.filter(
      (n) => n.id.toLowerCase() !== q && n.title.toLowerCase() !== q
    );
    const deleted = this.data.notes.length < initialLen;
    if (deleted) {
      this.save();
      const supabase = getSupabaseClient();
      if (supabase && target) {
        supabase.from('notes').delete().eq('id', target.id).then(({ error }) => {
          if (error) console.warn('Supabase note delete error:', error.message);
        }).catch(() => {});
      }
    }
    return deleted;
  }

  // ── Reminders ──
  addReminder(title: string, remindAt: string): ReminderItem {
    const reminder: ReminderItem = {
      id: `rem_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      title,
      remindAt,
      triggered: false,
      createdAt: Date.now()
    };
    this.data.reminders.push(reminder);
    this.save();

    const supabase = getSupabaseClient();
    if (supabase) {
      supabase.from('reminders').insert({
        id: reminder.id,
        title: reminder.title,
        remind_at: reminder.remindAt,
        triggered: false,
        created_at: new Date(reminder.createdAt).toISOString()
      }).then(({ error }) => {
        if (error) console.warn('Supabase reminder insert error:', error.message);
      }).catch(() => {});
    }

    return reminder;
  }

  listReminders(): ReminderItem[] {
    return this.data.reminders;
  }

  // ── Conversation History ──
  addHistoryTurn(role: string, content: string): void {
    const timestamp = Date.now();
    this.data.conversationHistory.push({
      role,
      content,
      timestamp
    });
    // Cap at last 50 turns
    if (this.data.conversationHistory.length > 50) {
      this.data.conversationHistory = this.data.conversationHistory.slice(-50);
    }
    this.save();

    const supabase = getSupabaseClient();
    if (supabase) {
      supabase.from('conversations').insert({
        role,
        content,
        created_at: new Date(timestamp).toISOString()
      }).then(({ error }) => {
        if (error) console.warn('Supabase conversation insert error:', error.message);
      }).catch(() => {});
    }
  }

  getRecentHistory(limit = 10): Array<{ role: string; content: string }> {
    return this.data.conversationHistory.slice(-limit);
  }

  clearHistory(): void {
    this.data.conversationHistory = [];
    this.save();

    const supabase = getSupabaseClient();
    if (supabase) {
      supabase.from('conversations').delete().neq('id', 0).then(({ error }) => {
        if (error) console.warn('Supabase clear conversations error:', error.message);
      }).catch(() => {});
    }
  }

  getPreferences(): Record<string, string> {
    return this.data.userPreferences;
  }
}
