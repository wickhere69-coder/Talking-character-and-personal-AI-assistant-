"""Tool registry and keyword-based tool selector."""
from __future__ import annotations

import re
from typing import Any, Callable, Dict, List, Optional

from agent.tools.filesystem_tools import create_file, list_files, read_file, search_files
from agent.tools.productivity_tools import (
    add_note,
    add_task,
    complete_task,
    delete_note,
    list_notes,
    list_tasks,
)
from agent.tools.weather_tools import get_weather, predict_weather
from agent.tools.web_tools import fetch_webpage, web_search

# ── Tool Definitions for LangChain / LLM Binding ─────────────────────────

TOOL_DEFINITIONS = [
    {
        "name": "predict_weather",
        "description": "Predict current weather and forecast for any city or location in the world.",
        "parameters": {
            "type": "object",
            "properties": {
                "location": {
                    "type": "string",
                    "description": "City name, optionally with country (e.g. 'Paris', 'Tokyo, Japan', 'New York').",
                }
            },
            "required": ["location"],
        },
        "func": predict_weather,
    },
    {
        "name": "get_weather",
        "description": "Alias for predict_weather. Get current weather and forecast for any location.",
        "parameters": {
            "type": "object",
            "properties": {
                "location": {"type": "string", "description": "City name."}
            },
            "required": ["location"],
        },
        "func": get_weather,
    },
    {
        "name": "web_search",
        "description": "Search the live web for current events, news, recent updates, or real-time facts.",
        "parameters": {
            "type": "object",
            "properties": {
                "query": {"type": "string", "description": "The search query string."}
            },
            "required": ["query"],
        },
        "func": web_search,
    },
    {
        "name": "fetch_webpage",
        "description": "Fetch and extract text content from a given webpage URL.",
        "parameters": {
            "type": "object",
            "properties": {
                "url": {"type": "string", "description": "Full URL to fetch (http/https)."}
            },
            "required": ["url"],
        },
        "func": fetch_webpage,
    },
    {
        "name": "add_task",
        "description": "Add a task to the personal to-do list.",
        "parameters": {
            "type": "object",
            "properties": {
                "title": {"type": "string", "description": "Task description or title."},
                "priority": {"type": "string", "enum": ["low", "medium", "high"], "description": "Priority level."},
                "due_date": {"type": "string", "description": "Optional due date."},
            },
            "required": ["title"],
        },
        "func": add_task,
    },
    {
        "name": "list_tasks",
        "description": "List all personal tasks, optionally filtered by status (pending / completed).",
        "parameters": {
            "type": "object",
            "properties": {
                "status": {"type": "string", "enum": ["pending", "completed"], "description": "Filter by status."}
            },
        },
        "func": list_tasks,
    },
    {
        "name": "complete_task",
        "description": "Mark a personal task as completed.",
        "parameters": {
            "type": "object",
            "properties": {
                "identifier": {"type": "string", "description": "Task ID or partial title to complete."}
            },
            "required": ["identifier"],
        },
        "func": complete_task,
    },
    {
        "name": "add_note",
        "description": "Save a personal note or quick thought.",
        "parameters": {
            "type": "object",
            "properties": {
                "title": {"type": "string", "description": "Note title."},
                "content": {"type": "string", "description": "Full content of the note."},
                "tags": {"type": "string", "description": "Comma-separated tags (e.g. 'work, ideas')."},
            },
            "required": ["title", "content"],
        },
        "func": add_note,
    },
    {
        "name": "list_notes",
        "description": "List all saved notes or search notes by tag.",
        "parameters": {
            "type": "object",
            "properties": {
                "tag": {"type": "string", "description": "Optional tag to filter notes."}
            },
        },
        "func": list_notes,
    },
    {
        "name": "delete_note",
        "description": "Delete a note by title or ID.",
        "parameters": {
            "type": "object",
            "properties": {
                "title_or_id": {"type": "string", "description": "Note title or ID to delete."}
            },
            "required": ["title_or_id"],
        },
        "func": delete_note,
    },
    {
        "name": "list_files",
        "description": "List files and directories in the local project directory.",
        "parameters": {
            "type": "object",
            "properties": {
                "path": {"type": "string", "description": "Relative directory path (defaults to root '.')."}
            },
        },
        "func": list_files,
    },
    {
        "name": "read_file",
        "description": "Read contents of a file in the project workspace.",
        "parameters": {
            "type": "object",
            "properties": {
                "path": {"type": "string", "description": "Relative file path."}
            },
            "required": ["path"],
        },
        "func": read_file,
    },
    {
        "name": "create_file",
        "description": "Create or overwrite a file in the project workspace.",
        "parameters": {
            "type": "object",
            "properties": {
                "path": {"type": "string", "description": "Relative file path to create."},
                "content": {"type": "string", "description": "Full file content."},
            },
            "required": ["path", "content"],
        },
        "func": create_file,
    },
    {
        "name": "search_files",
        "description": "Search for files matching a pattern in the project workspace.",
        "parameters": {
            "type": "object",
            "properties": {
                "pattern": {"type": "string", "description": "Glob pattern (e.g. '*.ts', 'App*')."},
                "directory": {"type": "string", "description": "Directory to search in."},
            },
            "required": ["pattern"],
        },
        "func": search_files,
    },
]

TOOL_REGISTRY: Dict[str, Dict[str, Any]] = {t["name"]: t for t in TOOL_DEFINITIONS}


def select_relevant_tools(user_message: str, provider_name: str = "auto") -> List[Dict[str, Any]]:
    """Keyword-based tool filtering, matching TypeScript AgentCore logic."""
    lower = user_message.lower().strip()

    # Fast check: common greetings & casual chat need zero tools (< 1ms fast-path)
    common_chat = [
        "hello", "hi", "hey", "how are you", "what is your name",
        "who are you", "tell me a joke", "good morning", "good evening",
        "good night", "thank you", "thanks", "bye", "goodbye", "how do you feel",
        "what do you think", "tell me about yourself", "are you there",
        "what's up", "whats up", "how's it going", "hows it going",
        "continue", "go on", "what were you saying", "finish your thought"
    ]
    if any(lower == c or lower.startswith(c + " ") or lower.endswith(" " + c) for c in common_chat):
        return []

    file_keywords = [
        "file", "files", "folder", "directory", "dir", "package.json", "readme",
        "read file", "write file", "create file", "delete file", "search code", "inspect code"
    ]
    task_keywords = [
        "add task", "list tasks", "todo", "to-do", "complete task",
        "add note", "list notes", "delete note"
    ]
    weather_keywords = [
        "weather", "wether", "forecast", "fore cast", "temperature", "temprature",
        "rain", "raining", "snow", "snowing", "wind", "sunny", "cloudy", "humidity",
        "predict weather", "storm", "celsius", "fahrenheit", "degrees"
    ]
    web_keywords = [
        "search online", "search the web", "search google", "search for news",
        "google", "browse", "lookup", "look up", "find online", "search for",
        "latest news", "current news", "breaking news", "recent news", "today's news",
        "what is happening today", "who won", "current price of",
        "stock price", "latest update on", "recent events", "current events",
        "election results", "super bowl", "championship winner", "world cup score"
    ]

    matched: set[str] = set()

    if any(kw in lower for kw in file_keywords):
        matched.update(["list_files", "read_file", "search_files", "create_file"])
    if any(kw in lower for kw in task_keywords):
        matched.update(["add_task", "list_tasks", "complete_task", "add_note", "list_notes", "delete_note"])
    if any(kw in lower for kw in weather_keywords):
        matched.update(["predict_weather", "get_weather"])
    if any(kw in lower for kw in web_keywords):
        matched.update(["web_search", "fetch_webpage"])

    return [t for t in TOOL_DEFINITIONS if t["name"] in matched]


def extract_location_from_query(query: str) -> Optional[str]:
    """Helper to extract location name from weather query for pre-fetching."""
    lower = query.lower()
    patterns = [
        r"(?:weather|forecast|temperature|climate)\s+(?:in|for|at|around)?\s*([a-zA-Z\s,]+)",
        r"what(?:'s| is) the weather (?:like )?(?:in|for|at)?\s*([a-zA-Z\s,]+)",
        r"how(?:'s| is) the weather (?:in|for|at)?\s*([a-zA-Z\s,]+)",
    ]
    for pat in patterns:
        m = re.search(pat, lower)
        if m:
            loc = m.group(1).strip()
            loc = re.sub(r"\b(right now|this week|today|tomorrow|tonight|currently|right|now|like|please)\b", "", loc).strip()
            loc = loc.rstrip("?.!").strip()
            if loc and len(loc) > 1:
                return loc
    return None

