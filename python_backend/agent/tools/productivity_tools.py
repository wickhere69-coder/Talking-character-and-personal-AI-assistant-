"""Productivity tools: tasks, notes, reminders — backed by SQLite via MemoryStore."""
from __future__ import annotations

from typing import Any, Dict, Optional


async def add_task(title: str, priority: str = "medium", due_date: Optional[str] = None) -> Dict[str, Any]:
    """Add a new task to the personal to-do list."""
    from memory.store import get_memory_store

    store = get_memory_store()
    task = await store.add_task(title, priority, due_date)
    return {
        "success": True,
        "data": task,
        "message": f'Added task: "{task["title"]}" (Priority: {task["priority"]}).',
    }


async def list_tasks(status: Optional[str] = None) -> Dict[str, Any]:
    """List personal tasks filtered by status."""
    from memory.store import get_memory_store

    store = get_memory_store()
    tasks = await store.list_tasks(status)
    if not tasks:
        return {"success": True, "message": "You have no tasks in your list."}
    summary = "\n".join(f"• [{t['status'].upper()}] {t['title']} ({t['priority']})" for t in tasks)
    return {
        "success": True,
        "data": tasks,
        "message": f"You have {len(tasks)} task(s):\n{summary}",
    }


async def complete_task(identifier: str) -> Dict[str, Any]:
    """Mark a task as completed by title or ID."""
    from memory.store import get_memory_store

    store = get_memory_store()
    ok = await store.complete_task(identifier)
    if ok:
        return {"success": True, "message": f'Marked task "{identifier}" as completed!'}
    return {"success": False, "error": "Task not found", "message": f'Could not find task "{identifier}".'}


async def add_note(title: str, content: str, tags: Optional[str] = None) -> Dict[str, Any]:
    """Create and save a personal note."""
    from memory.store import get_memory_store

    store = get_memory_store()
    tag_list = [t.strip() for t in tags.split(",")] if tags else []
    note = await store.add_note(title, content, tag_list)
    return {"success": True, "data": note, "message": f'Saved note "{note["title"]}".'}


async def list_notes(tag: Optional[str] = None) -> Dict[str, Any]:
    """List all saved notes or search by tag."""
    from memory.store import get_memory_store

    store = get_memory_store()
    notes = await store.list_notes(tag)
    if not notes:
        return {"success": True, "message": "You have no saved notes yet."}
    summary = "\n".join(
        f"• {n['title']}: {n['content']} (tags: {', '.join(n.get('tags', [])) or 'none'})" for n in notes
    )
    return {
        "success": True,
        "data": notes,
        "message": f"Found {len(notes)} note(s):\n{summary}",
    }


async def delete_note(title_or_id: str) -> Dict[str, Any]:
    """Delete a saved note by title or ID."""
    from memory.store import get_memory_store

    store = get_memory_store()
    ok = await store.delete_note(title_or_id)
    if ok:
        return {"success": True, "message": f'Deleted note "{title_or_id}".'}
    return {"success": False, "error": "Note not found", "message": f'Could not find note "{title_or_id}".'}


async def add_reminder(title: str, remind_at: str) -> Dict[str, Any]:
    """Set a personal reminder."""
    from memory.store import get_memory_store

    store = get_memory_store()
    reminder = await store.add_reminder(title, remind_at)
    return {
        "success": True,
        "data": reminder,
        "message": f'Set reminder: "{reminder["title"]}" for {reminder["remind_at"]}.',
    }


async def list_reminders() -> Dict[str, Any]:
    """List all reminders."""
    from memory.store import get_memory_store

    store = get_memory_store()
    reminders = await store.list_reminders()
    if not reminders:
        return {"success": True, "message": "You have no reminders set."}
    summary = "\n".join(f"• {r['title']} — {r['remind_at']}" for r in reminders)
    return {"success": True, "data": reminders, "message": f"Your reminders:\n{summary}"}
