import fs from 'fs';
import path from 'path';
import { MemoryItem, TaskItem, NoteItem, ReminderItem } from '../types';

interface MemorySchema {
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
    const initialLen = this.data.notes.length;
    this.data.notes = this.data.notes.filter(
      (n) => n.id.toLowerCase() !== q && n.title.toLowerCase() !== q
    );
    const deleted = this.data.notes.length < initialLen;
    if (deleted) this.save();
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
    return reminder;
  }

  listReminders(): ReminderItem[] {
    return this.data.reminders;
  }

  // ── Conversation History ──
  addHistoryTurn(role: string, content: string): void {
    this.data.conversationHistory.push({
      role,
      content,
      timestamp: Date.now()
    });
    // Cap at last 50 turns
    if (this.data.conversationHistory.length > 50) {
      this.data.conversationHistory = this.data.conversationHistory.slice(-50);
    }
    this.save();
  }

  getRecentHistory(limit = 10): Array<{ role: string; content: string }> {
    return this.data.conversationHistory.slice(-limit);
  }

  clearHistory(): void {
    this.data.conversationHistory = [];
    this.save();
  }

  getPreferences(): Record<string, string> {
    return this.data.userPreferences;
  }
}
