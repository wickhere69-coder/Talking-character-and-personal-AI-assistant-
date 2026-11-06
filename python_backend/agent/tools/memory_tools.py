"""Long-term personal memory tools ("you remembered my sister's name!")."""
from __future__ import annotations

import re
from typing import Any, Dict

from memory.store import get_memory_store
from utils.logger import get_logger

logger = get_logger(__name__)

_PREFERENCE_HINTS = re.compile(r"\b(prefer|favou?rite|likes?|loves?|hates?|dislikes?|name|call me|pronouns?)\b", re.IGNORECASE)


def _normalize_key(topic: str) -> str:
    key = re.sub(r"\s+", " ", (topic or "").strip().lower())
    return key[:80]


async def remember_about_user(topic: str, detail: str) -> Dict[str, Any]:
    """Save a durable fact about the user (overwrites the same topic)."""
    key = _normalize_key(topic)
    value = (detail or "").strip()
    if not key or not value:
        return {"success": False, "status": "invalid_argument", "message": "Both topic and detail are required."}
    category = "preference" if _PREFERENCE_HINTS.search(f"{key} {value}") else "fact"
    await get_memory_store().remember(key, value[:500], category=category)
    logger.info("Remembered about user: %s = %s", key, value[:80])
    return {"success": True, "status": "ok", "message": f"Saved: {key} — {value[:200]}"}


async def recall_about_user(query: str = "") -> Dict[str, Any]:
    """Look up what Aura remembers about the user."""
    store = get_memory_store()
    q = (query or "").strip()
    items = await store.recall(q) if q else []
    if not items:
        items = await store.list_memories()
        if q:
            words = [w for w in re.findall(r"[a-z0-9']+", q.lower()) if len(w) > 2]
            scored = [
                (sum(w in f"{m['key']} {m['value']}".lower() for w in words), m) for m in items
            ]
            items = [m for s, m in sorted(scored, key=lambda x: -x[0]) if s > 0] or items
    items = items[:12]
    if not items:
        return {"success": True, "status": "no_results", "message": "Nothing saved about that yet."}
    lines = "; ".join(f"{m['key']}: {m['value']}" for m in items)
    return {"success": True, "status": "ok", "message": lines}
