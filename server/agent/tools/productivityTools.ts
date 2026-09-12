import { ToolRegistry } from './ToolRegistry';
import { MemoryStore } from '../memory/MemoryStore';
import { ToolResult } from '../types';

export function registerProductivityTools(registry: ToolRegistry, memory: MemoryStore): void {
  // 1. add_note
  registry.registerTool(
    {
      name: 'add_note',
      description: 'Create and save a personal note with a title and content.',
      permission: 'SAFE_WRITE',
      parameters: {
        title: { type: 'string', description: 'Title or subject of the note', required: true },
        content: { type: 'string', description: 'Content of the note', required: true },
        tags: { type: 'string', description: 'Comma-separated tags (optional)', required: false }
      }
    },
    async (params): Promise<ToolResult> => {
      const tags = params.tags ? params.tags.split(',').map((t: string) => t.trim()) : [];
      const note = memory.addNote(params.title, params.content, tags);
      return {
        success: true,
        data: note,
        message: `Saved note "${note.title}".`
      };
    }
  );

  // 2. list_notes
  registry.registerTool(
    {
      name: 'list_notes',
      description: 'List all saved notes or search notes by tag or keyword.',
      permission: 'READ_ONLY',
      parameters: {
        tag: { type: 'string', description: 'Filter notes by tag or keyword', required: false }
      }
    },
    async (params): Promise<ToolResult> => {
      const notes = memory.listNotes(params.tag);
      if (notes.length === 0) {
        return { success: true, message: 'You have no saved notes yet.' };
      }
      const summary = notes.map((n) => `• ${n.title}: ${n.content} (tags: ${n.tags.join(', ') || 'none'})`).join('\n');
      return {
        success: true,
        data: notes,
        message: `Found ${notes.length} note(s):\n${summary}`
      };
    }
  );

  // 3. delete_note
  registry.registerTool(
    {
      name: 'delete_note',
      description: 'Delete a saved note by title or ID.',
      permission: 'SAFE_WRITE',
      parameters: {
        titleOrId: { type: 'string', description: 'Title or ID of note to remove', required: true }
      }
    },
    async (params): Promise<ToolResult> => {
      const ok = memory.deleteNote(params.titleOrId);
      if (ok) {
        return { success: true, message: `Deleted note "${params.titleOrId}".` };
      }
      return { success: false, error: 'Note not found', message: `Could not find note "${params.titleOrId}".` };
    }
  );

  // 4. add_task
  registry.registerTool(
    {
      name: 'add_task',
      description: 'Add a new task to the personal to-do list.',
      permission: 'SAFE_WRITE',
      parameters: {
        title: { type: 'string', description: 'Task description or title', required: true },
        priority: { type: 'string', description: 'Priority level: low, medium, or high', required: false, default: 'medium' },
        dueDate: { type: 'string', description: 'Optional due date/time', required: false }
      }
    },
    async (params): Promise<ToolResult> => {
      const task = memory.addTask(params.title, params.priority || 'medium', params.dueDate);
      return {
        success: true,
        data: task,
        message: `Added task: "${task.title}" (Priority: ${task.priority}).`
      };
    }
  );

  // 5. list_tasks
  registry.registerTool(
    {
      name: 'list_tasks',
      description: 'List personal tasks filtered by status (pending or completed).',
      permission: 'READ_ONLY',
      parameters: {
        status: { type: 'string', description: 'Filter by "pending" or "completed"', required: false }
      }
    },
    async (params): Promise<ToolResult> => {
      const tasks = memory.listTasks(params.status);
      if (tasks.length === 0) {
        return { success: true, message: 'You have no tasks in your list.' };
      }
      const summary = tasks.map((t) => `• [${t.status.toUpperCase()}] ${t.title} (${t.priority})`).join('\n');
      return {
        success: true,
        data: tasks,
        message: `You have ${tasks.length} task(s):\n${summary}`
      };
    }
  );

  // 6. complete_task
  registry.registerTool(
    {
      name: 'complete_task',
      description: 'Mark a task as completed by title or ID.',
      permission: 'SAFE_WRITE',
      parameters: {
        identifier: { type: 'string', description: 'Task title or ID', required: true }
      }
    },
    async (params): Promise<ToolResult> => {
      const ok = memory.completeTask(params.identifier);
      if (ok) {
        return { success: true, message: `Marked task "${params.identifier}" as completed!` };
      }
      return { success: false, error: 'Task not found', message: `Could not find task "${params.identifier}".` };
    }
  );

  // 7. set_reminder
  registry.registerTool(
    {
      name: 'set_reminder',
      description: 'Schedule a personal reminder for a specific time or event.',
      permission: 'SAFE_WRITE',
      parameters: {
        title: { type: 'string', description: 'Reminder description', required: true },
        time: { type: 'string', description: 'When to remind (e.g. "tomorrow 9am", "in 2 hours")', required: true }
      }
    },
    async (params): Promise<ToolResult> => {
      const rem = memory.addReminder(params.title, params.time);
      return {
        success: true,
        data: rem,
        message: `Set reminder: "${rem.title}" for ${rem.remindAt}.`
      };
    }
  );

  // 8. remember_info
  registry.registerTool(
    {
      name: 'remember_info',
      description: 'Save a permanent fact, preference, or detail about the user or project into long-term memory.',
      permission: 'SAFE_WRITE',
      parameters: {
        key: { type: 'string', description: 'Memory label or subject', required: true },
        value: { type: 'string', description: 'The exact fact or preference to remember', required: true },
        category: { type: 'string', description: 'fact, preference, or project', required: false, default: 'fact' }
      }
    },
    async (params): Promise<ToolResult> => {
      const mem = memory.remember(params.key, params.value, params.category || 'fact');
      return {
        success: true,
        data: mem,
        message: `Stored in memory: ${mem.key} -> ${mem.value}`
      };
    }
  );

  // 9. recall_info
  registry.registerTool(
    {
      name: 'recall_info',
      description: 'Search personal memory for previously remembered facts, preferences, or details.',
      permission: 'READ_ONLY',
      parameters: {
        query: { type: 'string', description: 'Search keyword or subject to recall', required: true }
      }
    },
    async (params): Promise<ToolResult> => {
      const items = memory.recall(params.query);
      if (items.length === 0) {
        const all = memory.getAllMemories();
        if (all.length > 0) {
          const allSummary = all.map((m) => `• ${m.key}: ${m.value}`).join('\n');
          return {
            success: true,
            message: `I couldn't find an exact match for "${params.query}", but here is what I remember:\n${allSummary}`
          };
        }
        return {
          success: true,
          message: `I don't have any saved memories matching "${params.query}" yet.`
        };
      }
      const summary = items.map((m) => `• ${m.key}: ${m.value}`).join('\n');
      return {
        success: true,
        data: items,
        message: `Here is what I remember:\n${summary}`
      };
    }
  );
}
