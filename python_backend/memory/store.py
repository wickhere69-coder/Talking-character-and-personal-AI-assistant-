"""SQLite-backed persistent memory and session store.
Supports full session CRUD, conversation messages, tasks, notes, facts, and preferences.
Automatically migrates existing TypeScript JSON files on first run.
"""
from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager
import json
import os
import time
from pathlib import Path
from typing import Any, Dict, List, Optional

import aiosqlite

from config import get_settings
from utils.logger import get_logger

logger = get_logger(__name__)

STOPWORDS = {
    "a", "about", "above", "after", "again", "against", "all", "am", "an", "and", "any", "are",
    "as", "at", "be", "because", "been", "before", "being", "below", "between", "both", "but", "by",
    "can", "cannot", "could", "did", "do", "does", "doing", "down", "during", "each", "few", "for",
    "from", "further", "had", "has", "have", "having", "he", "her", "here", "hers", "herself", "him",
    "himself", "his", "how", "i", "if", "in", "into", "is", "it", "its", "itself", "let", "me",
    "more", "most", "my", "myself", "no", "nor", "not", "of", "off", "on", "once", "only", "or",
    "other", "ought", "our", "ours", "ourselves", "out", "over", "own", "same", "she", "should",
    "so", "some", "such", "than", "that", "the", "their", "theirs", "them", "themselves", "then",
    "there", "these", "they", "this", "those", "through", "to", "too", "under", "until", "up",
    "very", "was", "we", "were", "what", "when", "where", "which", "while", "who", "whom", "why",
    "with", "would", "you", "your", "yours", "yourself", "yourselves"
}


def extract_keywords(text: str) -> List[str]:
    import re
    cleaned = re.sub(r"[^\w\s-]", " ", text.lower())
    tokens = cleaned.split()
    return [t for t in tokens if len(t) > 2 and t not in STOPWORDS]


class MemoryStore:
    def __init__(self, db_path: Optional[str] = None):
        settings = get_settings()
        self.db_path = db_path or settings.db_path
        self._initialized = False

    @asynccontextmanager
    async def get_connection(self):
        db_file = Path(self.db_path)
        db_file.parent.mkdir(parents=True, exist_ok=True)
        conn = await aiosqlite.connect(self.db_path, timeout=15.0)
        conn.row_factory = aiosqlite.Row
        await conn.execute("PRAGMA foreign_keys = ON;")
        try:
            yield conn
        finally:
            await conn.close()

    async def init_db(self) -> None:
        if self._initialized:
            return
        async with self.get_connection() as conn:
            await conn.execute("PRAGMA journal_mode = WAL;")
            # 1. Sessions table
            await conn.execute("""
                CREATE TABLE IF NOT EXISTS sessions (
                    id TEXT PRIMARY KEY,
                    title TEXT NOT NULL,
                    topic TEXT NOT NULL DEFAULT 'General',
                    summary TEXT DEFAULT '',
                    established_facts TEXT DEFAULT '[]',
                    created_at INTEGER NOT NULL,
                    updated_at INTEGER NOT NULL,
                    pinned INTEGER DEFAULT 0,
                    pinned_at INTEGER,
                    archived INTEGER DEFAULT 0,
                    archived_at INTEGER,
                    message_count INTEGER DEFAULT 0
                );
            """)

            # 2. Messages table
            await conn.execute("""
                CREATE TABLE IF NOT EXISTS messages (
                    id TEXT PRIMARY KEY,
                    session_id TEXT NOT NULL,
                    role TEXT NOT NULL,
                    content TEXT NOT NULL,
                    created_at INTEGER NOT NULL,
                    status TEXT DEFAULT 'delivered',
                    model_used TEXT,
                    audio_duration_ms INTEGER,
                    interrupted INTEGER DEFAULT 0,
                    unspoken_content TEXT DEFAULT '',
                    pending INTEGER DEFAULT 0,
                    attachment TEXT DEFAULT '{}',
                    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
                );
            """)

            # Ensure unspoken_content column exists for existing DBs
            try:
                await conn.execute("ALTER TABLE messages ADD COLUMN unspoken_content TEXT DEFAULT '';")
            except Exception:
                pass

            # 3. Memories / Key-Value facts
            await conn.execute("""
                CREATE TABLE IF NOT EXISTS memories (
                    id TEXT PRIMARY KEY,
                    key TEXT NOT NULL UNIQUE,
                    value TEXT NOT NULL,
                    category TEXT DEFAULT 'fact',
                    created_at INTEGER NOT NULL,
                    updated_at INTEGER NOT NULL
                );
            """)

            # 4. User Preferences
            await conn.execute("""
                CREATE TABLE IF NOT EXISTS user_preferences (
                    key TEXT PRIMARY KEY,
                    value TEXT NOT NULL
                );
            """)

            # 5. Tasks
            await conn.execute("""
                CREATE TABLE IF NOT EXISTS tasks (
                    id TEXT PRIMARY KEY,
                    title TEXT NOT NULL,
                    status TEXT DEFAULT 'pending',
                    priority TEXT DEFAULT 'medium',
                    due_date TEXT,
                    created_at INTEGER NOT NULL
                );
            """)

            # 6. Notes
            await conn.execute("""
                CREATE TABLE IF NOT EXISTS notes (
                    id TEXT PRIMARY KEY,
                    title TEXT NOT NULL,
                    content TEXT NOT NULL,
                    tags TEXT DEFAULT '[]',
                    created_at INTEGER NOT NULL
                );
            """)

            # 7. Reminders
            await conn.execute("""
                CREATE TABLE IF NOT EXISTS reminders (
                    id TEXT PRIMARY KEY,
                    title TEXT NOT NULL,
                    remind_at TEXT NOT NULL,
                    triggered INTEGER DEFAULT 0,
                    created_at INTEGER NOT NULL
                );
            """)

            # 8. Global conversation history (legacy compatibility)
            await conn.execute("""
                CREATE TABLE IF NOT EXISTS conversation_history (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    role TEXT NOT NULL,
                    content TEXT NOT NULL,
                    timestamp INTEGER NOT NULL
                );
            """)

            await conn.commit()

        self._initialized = True
        logger.info(f"Initialized SQLite database at {self.db_path}")

        # Check and migrate legacy data
        await self.migrate_from_legacy()

    async def migrate_from_legacy(self) -> None:
        """Migrate existing TypeScript JSON files if SQLite database is empty."""
        settings = get_settings()
        async with self.get_connection() as conn:
            cursor = await conn.execute("SELECT COUNT(*) FROM sessions")
            session_count = (await cursor.fetchone())[0]

            if session_count == 0:
                # Try migrating from sessions.json
                sessions_file = Path(settings.legacy_sessions_path)
                if sessions_file.exists():
                    try:
                        data = json.loads(sessions_file.read_text(encoding="utf-8"))
                        sessions_list = data.get("sessions", [])
                        messages_dict = data.get("messages", {})

                        for s in sessions_list:
                            await conn.execute("""
                                INSERT OR REPLACE INTO sessions 
                                (id, title, topic, summary, established_facts, created_at, updated_at, pinned, pinned_at, archived, archived_at, message_count)
                                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                            """, (
                                s.get("id"),
                                s.get("title", "New Conversation"),
                                s.get("topic", "General"),
                                s.get("summary", ""),
                                json.dumps(s.get("establishedFacts", [])),
                                s.get("createdAt", int(time.time() * 1000)),
                                s.get("updatedAt", int(time.time() * 1000)),
                                1 if s.get("pinned") else 0,
                                s.get("pinnedAt"),
                                1 if s.get("archived") else 0,
                                s.get("archivedAt"),
                                s.get("messageCount", 0),
                            ))

                        for sess_id, msgs in messages_dict.items():
                            for m in msgs:
                                await conn.execute("""
                                    INSERT OR REPLACE INTO messages
                                    (id, session_id, role, content, created_at, status, model_used, audio_duration_ms, interrupted, pending, attachment)
                                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                                """, (
                                    m.get("id"),
                                    sess_id,
                                    m.get("role"),
                                    m.get("content"),
                                    m.get("createdAt", int(time.time() * 1000)),
                                    m.get("status", "delivered"),
                                    m.get("modelUsed"),
                                    m.get("audioDurationMs"),
                                    1 if m.get("interrupted") else 0,
                                    1 if m.get("pending") else 0,
                                    json.dumps(m.get("attachment", {})),
                                ))

                        await conn.commit()
                        logger.info(f"Successfully migrated {len(sessions_list)} sessions from legacy {sessions_file}")
                    except Exception as e:
                        logger.warn(f"Notice migrating sessions.json: {e}")

                # Ensure at least one default session exists
                cursor = await conn.execute("SELECT COUNT(*) FROM sessions")
                if (await cursor.fetchone())[0] == 0:
                    default_id = "session_default_general"
                    now = int(time.time() * 1000)
                    await conn.execute("""
                        INSERT INTO sessions (id, title, topic, summary, established_facts, created_at, updated_at, message_count)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                    """, (default_id, "New Conversation", "General Assistant", "", "[]", now, now, 0))
                    await conn.commit()

            # Migrate memory.json
            cursor = await conn.execute("SELECT COUNT(*) FROM memories")
            mem_count = (await cursor.fetchone())[0]
            if mem_count == 0:
                memory_file = Path(settings.legacy_memory_path)
                if memory_file.exists():
                    try:
                        mem_data = json.loads(memory_file.read_text(encoding="utf-8"))
                        for m in mem_data.get("memories", []):
                            await conn.execute("""
                                INSERT OR REPLACE INTO memories (id, key, value, category, created_at, updated_at)
                                VALUES (?, ?, ?, ?, ?, ?)
                            """, (
                                m.get("id", f"mem_{int(time.time() * 1000)}"),
                                m.get("key"),
                                m.get("value"),
                                m.get("category", "fact"),
                                m.get("createdAt", int(time.time() * 1000)),
                                m.get("updatedAt", int(time.time() * 1000)),
                            ))

                        for k, v in mem_data.get("userPreferences", {}).items():
                            await conn.execute("""
                                INSERT OR REPLACE INTO user_preferences (key, value) VALUES (?, ?)
                            """, (k, str(v)))

                        for t in mem_data.get("tasks", []):
                            await conn.execute("""
                                INSERT OR REPLACE INTO tasks (id, title, status, priority, due_date, created_at)
                                VALUES (?, ?, ?, ?, ?, ?)
                            """, (
                                t.get("id"),
                                t.get("title"),
                                t.get("status", "pending"),
                                t.get("priority", "medium"),
                                t.get("dueDate"),
                                t.get("createdAt", int(time.time() * 1000)),
                            ))

                        for n in mem_data.get("notes", []):
                            await conn.execute("""
                                INSERT OR REPLACE INTO notes (id, title, content, tags, created_at)
                                VALUES (?, ?, ?, ?, ?)
                            """, (
                                n.get("id"),
                                n.get("title"),
                                n.get("content"),
                                json.dumps(n.get("tags", [])),
                                n.get("createdAt", int(time.time() * 1000)),
                            ))

                        for r in mem_data.get("reminders", []):
                            await conn.execute("""
                                INSERT OR REPLACE INTO reminders (id, title, remind_at, triggered, created_at)
                                VALUES (?, ?, ?, ?, ?)
                            """, (
                                r.get("id"),
                                r.get("title"),
                                r.get("remindAt"),
                                1 if r.get("triggered") else 0,
                                r.get("createdAt", int(time.time() * 1000)),
                            ))

                        await conn.commit()
                        logger.info("Successfully migrated memory items from legacy memory.json")
                    except Exception as e:
                        logger.warn(f"Notice migrating memory.json: {e}")

    # ── Session Operations ────────────────────────────────────────────────

    async def create_session(self, title: Optional[str] = None, topic: Optional[str] = None) -> Dict[str, Any]:
        now = int(time.time() * 1000)
        import secrets
        sess_id = f"session_{now}_{secrets.token_hex(3)}"
        sess_title = (title or "New Conversation").strip()
        sess_topic = (topic or "General").strip()

        async with self.get_connection() as conn:
            await conn.execute("""
                INSERT INTO sessions (id, title, topic, summary, established_facts, created_at, updated_at, pinned, pinned_at, archived, archived_at, message_count)
                VALUES (?, ?, ?, '', '[]', ?, ?, 0, NULL, 0, NULL, 0)
            """, (sess_id, sess_title, sess_topic, now, now))
            await conn.commit()

        return {
            "id": sess_id,
            "title": sess_title,
            "topic": sess_topic,
            "summary": "",
            "establishedFacts": [],
            "createdAt": now,
            "updatedAt": now,
            "pinned": False,
            "pinnedAt": None,
            "archived": False,
            "archivedAt": None,
            "messageCount": 0,
        }

    async def list_sessions(self, include_archived: bool = False, search: Optional[str] = None) -> List[Dict[str, Any]]:
        async with self.get_connection() as conn:
            query = "SELECT * FROM sessions"
            params: List[Any] = []
            conditions: List[str] = []

            if not include_archived:
                conditions.append("archived = 0")

            if search and search.strip():
                q = f"%{search.strip().lower()}%"
                conditions.append("(LOWER(title) LIKE ? OR LOWER(topic) LIKE ? OR LOWER(summary) LIKE ?)")
                params.extend([q, q, q])

            if conditions:
                query += " WHERE " + " AND ".join(conditions)

            query += " ORDER BY pinned DESC, CASE WHEN pinned = 1 THEN pinned_at ELSE updated_at END DESC"
            cursor = await conn.execute(query, params)
            rows = await cursor.fetchall()

            result = []
            for r in rows:
                result.append({
                    "id": r["id"],
                    "title": r["title"],
                    "topic": r["topic"],
                    "summary": r["summary"],
                    "establishedFacts": json.loads(r["established_facts"] or "[]"),
                    "createdAt": r["created_at"],
                    "updatedAt": r["updated_at"],
                    "pinned": bool(r["pinned"]),
                    "pinnedAt": r["pinned_at"],
                    "archived": bool(r["archived"]),
                    "archivedAt": r["archived_at"],
                    "messageCount": r["message_count"],
                })
            return result

    async def get_session(self, session_id: str) -> Optional[Dict[str, Any]]:
        async with self.get_connection() as conn:
            cursor = await conn.execute("SELECT * FROM sessions WHERE id = ?", (session_id,))
            s = await cursor.fetchone()
            if not s:
                return None

            cursor = await conn.execute("SELECT * FROM messages WHERE session_id = ? ORDER BY created_at ASC", (session_id,))
            msgs = await cursor.fetchall()

            return {
                "session": {
                    "id": s["id"],
                    "title": s["title"],
                    "topic": s["topic"],
                    "summary": s["summary"],
                    "establishedFacts": json.loads(s["established_facts"] or "[]"),
                    "createdAt": s["created_at"],
                    "updatedAt": s["updated_at"],
                    "pinned": bool(s["pinned"]),
                    "pinnedAt": s["pinned_at"],
                    "archived": bool(s["archived"]),
                    "archivedAt": s["archived_at"],
                    "messageCount": s["message_count"],
                },
                "messages": [
                    {
                        "id": m["id"],
                        "sessionId": m["session_id"],
                        "role": m["role"],
                        "content": m["content"],
                        "createdAt": m["created_at"],
                        "status": m["status"],
                        "modelUsed": m["model_used"],
                        "audioDurationMs": m["audio_duration_ms"],
                        "interrupted": bool(m["interrupted"]),
                        "pending": bool(m["pending"]),
                        "attachment": json.loads(m["attachment"] or "{}"),
                    }
                    for m in msgs
                ],
            }

    async def update_session(self, session_id: str, **updates: Any) -> Optional[Dict[str, Any]]:
        async with self.get_connection() as conn:
            cursor = await conn.execute("SELECT * FROM sessions WHERE id = ?", (session_id,))
            row = await cursor.fetchone()
            if not row:
                return None

            now = int(time.time() * 1000)
            fields: List[str] = ["updated_at = ?"]
            params: List[Any] = [now]

            if "title" in updates and updates["title"] is not None:
                fields.append("title = ?")
                params.append(str(updates["title"]).strip())
            if "topic" in updates and updates["topic"] is not None:
                fields.append("topic = ?")
                params.append(str(updates["topic"]).strip())
            if "summary" in updates and updates["summary"] is not None:
                fields.append("summary = ?")
                params.append(str(updates["summary"]).strip())
            if "establishedFacts" in updates:
                fields.append("established_facts = ?")
                params.append(json.dumps(updates["establishedFacts"]))
            if "pinned" in updates:
                is_pinned = 1 if updates["pinned"] else 0
                fields.append("pinned = ?")
                params.append(is_pinned)
                fields.append("pinned_at = ?")
                params.append(now if is_pinned else None)
            if "archived" in updates:
                is_archived = 1 if updates["archived"] else 0
                fields.append("archived = ?")
                params.append(is_archived)
                fields.append("archived_at = ?")
                params.append(now if is_archived else None)

            params.append(session_id)
            query = f"UPDATE sessions SET {', '.join(fields)} WHERE id = ?"
            await conn.execute(query, params)
            await conn.commit()

        sess_data = await self.get_session(session_id)
        return sess_data["session"] if sess_data else None

    async def delete_session(self, session_id: str) -> bool:
        remaining = 1
        async with self.get_connection() as conn:
            # Delete messages first
            await conn.execute("DELETE FROM messages WHERE session_id = ?", (session_id,))
            cursor = await conn.execute("DELETE FROM sessions WHERE id = ?", (session_id,))
            await conn.commit()
            deleted = cursor.rowcount > 0

            # Check if any sessions remain
            cursor = await conn.execute("SELECT COUNT(*) FROM sessions")
            remaining = (await cursor.fetchone())[0]

        # Outside the connection context to prevent SQLite database lock contention
        if remaining == 0:
            await self.create_session("New Conversation", "General")

        return True

    # ── Message Operations ────────────────────────────────────────────────

    async def add_message(
        self,
        session_id: str,
        role: str,
        content: str,
        **extra: Any,
    ) -> Dict[str, Any]:
        now = int(time.time() * 1000)
        import secrets
        msg_id = extra.get("id") or f"msg_{now}_{secrets.token_hex(3)}"

        async with self.get_connection() as conn:
            # Auto-create session if it doesn't exist
            cursor = await conn.execute("SELECT id, title, message_count FROM sessions WHERE id = ?", (session_id,))
            s_row = await cursor.fetchone()
            if not s_row:
                await conn.execute("""
                    INSERT INTO sessions (id, title, topic, created_at, updated_at, message_count)
                    VALUES (?, 'Conversation', 'General', ?, ?, 0)
                """, (session_id, now, now))
                s_title = "Conversation"
                s_count = 0
            else:
                s_title = s_row["title"]
                s_count = s_row["message_count"]

            await conn.execute("""
                INSERT INTO messages 
                (id, session_id, role, content, created_at, status, model_used, audio_duration_ms, interrupted, unspoken_content, pending, attachment)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                msg_id,
                session_id,
                role,
                content,
                extra.get("createdAt") or now,
                extra.get("status", "delivered"),
                extra.get("modelUsed"),
                extra.get("audioDurationMs"),
                1 if extra.get("interrupted") else 0,
                extra.get("unspoken_content") or extra.get("unspokenContent", ""),
                1 if extra.get("pending") else 0,
                json.dumps(extra.get("attachment", {})),
            ))

            new_count = s_count + 1
            await conn.execute("""
                UPDATE sessions SET message_count = ?, updated_at = ? WHERE id = ?
            """, (new_count, now, session_id))

            # Auto-title on first turn if generic
            if new_count <= 2 and (s_title in ("New Conversation", "Conversation") or s_title.startswith("Session ")):
                derived_title = self._derive_title(content)
                if derived_title:
                    await conn.execute("UPDATE sessions SET title = ? WHERE id = ?", (derived_title, session_id))

            await conn.commit()

        return {
            "id": msg_id,
            "sessionId": session_id,
            "role": role,
            "content": content,
            "createdAt": now,
            "status": extra.get("status", "delivered"),
            "modelUsed": extra.get("modelUsed"),
            "audioDurationMs": extra.get("audioDurationMs"),
            "interrupted": bool(extra.get("interrupted")),
            "pending": bool(extra.get("pending")),
        }

    async def get_messages(self, session_id: str, limit: Optional[int] = None) -> List[Dict[str, Any]]:
        async with self.get_connection() as conn:
            query = "SELECT * FROM messages WHERE session_id = ? ORDER BY created_at ASC"
            cursor = await conn.execute(query, (session_id,))
            rows = await cursor.fetchall()
            if limit and limit > 0:
                rows = rows[-limit:]

            return [
                {
                    "id": m["id"],
                    "sessionId": m["session_id"],
                    "role": m["role"],
                    "content": m["content"],
                    "createdAt": m["created_at"],
                    "status": m["status"],
                    "modelUsed": m["model_used"],
                    "audioDurationMs": m["audio_duration_ms"],
                    "interrupted": bool(m["interrupted"]),
                    "unspokenContent": m["unspoken_content"] if "unspoken_content" in m.keys() else "",
                    "pending": bool(m["pending"]),
                }
                for m in rows
            ]

    async def mark_message_interrupted(
        self,
        session_id: str,
        message_id: Optional[str] = None,
        spoken_content: Optional[str] = None,
        unspoken_content: Optional[str] = None,
    ) -> bool:
        """Mark an assistant message as interrupted by user barge-in."""
        async with self.get_connection() as conn:
            target_id = message_id
            if not target_id:
                # Find most recent assistant message
                cursor = await conn.execute(
                    "SELECT id, content FROM messages WHERE session_id = ? AND role = 'assistant' ORDER BY created_at DESC LIMIT 1",
                    (session_id,)
                )
                row = await cursor.fetchone()
                if not row:
                    # Auto-create session if missing and insert assistant message
                    cursor = await conn.execute("SELECT id FROM sessions WHERE id = ?", (session_id,))
                    if not await cursor.fetchone():
                        now = int(time.time() * 1000)
                        await conn.execute("""
                            INSERT INTO sessions (id, title, topic, created_at, updated_at, message_count)
                            VALUES (?, 'Conversation', 'General', ?, ?, 0)
                        """, (session_id, now, now))

                    now = int(time.time() * 1000)
                    import secrets
                    new_id = f"msg_a_{now}_{secrets.token_hex(3)}"
                    await conn.execute("""
                        INSERT INTO messages (id, session_id, role, content, created_at, status, interrupted, unspoken_content)
                        VALUES (?, ?, 'assistant', ?, ?, 'delivered', 1, ?)
                    """, (new_id, session_id, (spoken_content or '').strip(), now, (unspoken_content or '').strip()))
                    await conn.commit()
                    return True
                target_id = row["id"]
                current_text = row["content"]
            else:
                cursor = await conn.execute("SELECT content FROM messages WHERE id = ?", (target_id,))
                row = await cursor.fetchone()
                current_text = row["content"] if row else ""

            fields = ["interrupted = 1"]
            params: List[Any] = []

            if spoken_content is not None and spoken_content.strip():
                fields.append("content = ?")
                params.append(spoken_content.strip())
            
            if unspoken_content is not None:
                fields.append("unspoken_content = ?")
                params.append(unspoken_content.strip())
            elif spoken_content and current_text:
                # Calculate remaining unspoken text
                if current_text.startswith(spoken_content.strip()):
                    rem = current_text[len(spoken_content.strip()):].strip()
                    fields.append("unspoken_content = ?")
                    params.append(rem)

            params.append(target_id)
            set_clause = ", ".join(fields)
            await conn.execute(f"UPDATE messages SET {set_clause} WHERE id = ?", tuple(params))
            await conn.commit()
            return True

    async def get_last_interrupted_message(self, session_id: str) -> Optional[Dict[str, Any]]:
        """Retrieve the latest interrupted assistant message in a session for resumption context."""
        async with self.get_connection() as conn:
            cursor = await conn.execute(
                """SELECT * FROM messages 
                   WHERE session_id = ? AND role = 'assistant' AND interrupted = 1 
                   ORDER BY created_at DESC LIMIT 1""",
                (session_id,)
            )
            row = await cursor.fetchone()
            if not row:
                return None
            return {
                "id": row["id"],
                "content": row["content"],
                "unspokenContent": row["unspoken_content"] if "unspoken_content" in row.keys() else "",
                "createdAt": row["created_at"],
            }

    async def update_rolling_summary(
        self,
        session_id: str,
        summary: str,
        established_facts: Optional[List[str]] = None,
        refined_topic: Optional[str] = None,
    ) -> None:
        async with self.get_connection() as conn:
            cursor = await conn.execute("SELECT established_facts FROM sessions WHERE id = ?", (session_id,))
            row = await cursor.fetchone()
            if not row:
                return

            existing_facts: List[str] = json.loads(row["established_facts"] or "[]")
            if established_facts:
                unique_facts = list(dict.fromkeys(existing_facts + established_facts))[:15]
            else:
                unique_facts = existing_facts

            now = int(time.time() * 1000)
            fields = ["summary = ?", "established_facts = ?", "updated_at = ?"]
            params: List[Any] = [summary, json.dumps(unique_facts), now]

            if refined_topic and refined_topic.strip():
                fields.append("topic = ?")
                params.append(refined_topic.strip())

            params.append(session_id)
            await conn.execute(f"UPDATE sessions SET {', '.join(fields)} WHERE id = ?", params)
            await conn.commit()

    async def retrieve_relevant_messages(
        self,
        session_id: str,
        query: str,
        limit: int = 4,
        exclude_recent: int = 8,
    ) -> List[Dict[str, Any]]:
        messages = await self.get_messages(session_id)
        if len(messages) <= exclude_recent:
            return []

        pool = messages[:-exclude_recent]
        query_tokens = extract_keywords(query)
        if not query_tokens:
            return []

        scored = []
        for msg in pool:
            msg_tokens = extract_keywords(msg["content"])
            token_set = set(msg_tokens)
            score = 0
            for qt in query_tokens:
                if qt in token_set:
                    score += 3
                elif any(mt.startswith(qt) or qt.startswith(mt) for mt in msg_tokens):
                    score += 1
            if query.lower() in msg["content"].lower():
                score += 8
            if score > 2:
                scored.append((score, msg))

        scored.sort(key=lambda x: x[0], reverse=True)
        return [item[1] for item in scored[:limit]]

    def _derive_title(self, prompt: str) -> Optional[str]:
        import re
        cleaned = re.sub(
            r"^(can you|could you|please|help me|tell me|what is|how do i|how to|i want to|let's talk about|explain)\s+",
            "", prompt, flags=re.IGNORECASE
        ).strip().rstrip("?.!")
        if not cleaned:
            return None
        words = cleaned.split()
        title = " ".join(words[:5]).capitalize()
        return title[:35] + ("..." if len(title) > 35 else "")

    # ── Memory Items & Preferences ────────────────────────────────────────

    async def remember(self, key: str, value: str, category: str = "fact") -> Dict[str, Any]:
        now = int(time.time() * 1000)
        import secrets
        mem_id = f"mem_{now}_{secrets.token_hex(2)}"

        async with self.get_connection() as conn:
            await conn.execute("""
                INSERT INTO memories (id, key, value, category, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?)
                ON CONFLICT(key) DO UPDATE SET value = excluded.value, category = excluded.category, updated_at = excluded.updated_at
            """, (mem_id, key, value, category, now, now))

            if category == "preference":
                await conn.execute("""
                    INSERT INTO user_preferences (key, value) VALUES (?, ?)
                    ON CONFLICT(key) DO UPDATE SET value = excluded.value
                """, (key, value))

            await conn.commit()

        return {"id": mem_id, "key": key, "value": value, "category": category, "updatedAt": now}

    async def recall(self, query: str) -> List[Dict[str, Any]]:
        q = query.lower()
        async with self.get_connection() as conn:
            cursor = await conn.execute("SELECT * FROM memories")
            rows = await cursor.fetchall()
            results = []
            for r in rows:
                k = r["key"].lower()
                v = r["value"].lower()
                c = (r["category"] or "").lower()
                if k in q or v in q or q in k or (c and c in q):
                    results.append({"id": r["id"], "key": r["key"], "value": r["value"], "category": r["category"]})
            return results

    async def list_memories(self, category: Optional[str] = None) -> List[Dict[str, Any]]:
        async with self.get_connection() as conn:
            if category:
                cursor = await conn.execute("SELECT * FROM memories WHERE category = ?", (category,))
            else:
                cursor = await conn.execute("SELECT * FROM memories")
            rows = await cursor.fetchall()
            return [{"id": r["id"], "key": r["key"], "value": r["value"], "category": r["category"]} for r in rows]

    async def delete_memory(self, key: str) -> bool:
        async with self.get_connection() as conn:
            cursor = await conn.execute("DELETE FROM memories WHERE LOWER(key) = LOWER(?)", (key,))
            await conn.execute("DELETE FROM user_preferences WHERE LOWER(key) = LOWER(?)", (key,))
            await conn.commit()
            return cursor.rowcount > 0

    async def get_preferences(self) -> Dict[str, str]:
        async with self.get_connection() as conn:
            cursor = await conn.execute("SELECT key, value FROM user_preferences")
            rows = await cursor.fetchall()
            return {r["key"]: r["value"] for r in rows}

    # ── Tasks ─────────────────────────────────────────────────────────────

    async def add_task(self, title: str, priority: str = "medium", due_date: Optional[str] = None) -> Dict[str, Any]:
        now = int(time.time() * 1000)
        import secrets
        task_id = f"task_{now}_{secrets.token_hex(2)}"
        async with self.get_connection() as conn:
            await conn.execute("""
                INSERT INTO tasks (id, title, status, priority, due_date, created_at)
                VALUES (?, ?, 'pending', ?, ?, ?)
            """, (task_id, title, priority, due_date, now))
            await conn.commit()
        return {"id": task_id, "title": title, "status": "pending", "priority": priority, "dueDate": due_date, "createdAt": now}

    async def list_tasks(self, status: Optional[str] = None) -> List[Dict[str, Any]]:
        async with self.get_connection() as conn:
            if status:
                cursor = await conn.execute("SELECT * FROM tasks WHERE status = ?", (status,))
            else:
                cursor = await conn.execute("SELECT * FROM tasks")
            rows = await cursor.fetchall()
            return [{"id": r["id"], "title": r["title"], "status": r["status"], "priority": r["priority"], "dueDate": r["due_date"]} for r in rows]

    async def complete_task(self, identifier: str) -> bool:
        async with self.get_connection() as conn:
            q = f"%{identifier.lower()}%"
            cursor = await conn.execute("""
                UPDATE tasks SET status = 'completed'
                WHERE LOWER(id) = LOWER(?) OR LOWER(title) LIKE ?
            """, (identifier, q))
            await conn.commit()
            return cursor.rowcount > 0

    # ── Notes ─────────────────────────────────────────────────────────────

    async def add_note(self, title: str, content: str, tags: Optional[List[str]] = None) -> Dict[str, Any]:
        now = int(time.time() * 1000)
        import secrets
        note_id = f"note_{now}_{secrets.token_hex(2)}"
        tags_list = tags or []
        async with self.get_connection() as conn:
            await conn.execute("""
                INSERT INTO notes (id, title, content, tags, created_at)
                VALUES (?, ?, ?, ?, ?)
            """, (note_id, title, content, json.dumps(tags_list), now))
            await conn.commit()
        return {"id": note_id, "title": title, "content": content, "tags": tags_list, "createdAt": now}

    async def list_notes(self, tag: Optional[str] = None) -> List[Dict[str, Any]]:
        async with self.get_connection() as conn:
            cursor = await conn.execute("SELECT * FROM notes")
            rows = await cursor.fetchall()
            results = []
            for r in rows:
                tags = json.loads(r["tags"] or "[]")
                if not tag or any(tag.lower() in t.lower() for t in tags) or tag.lower() in r["title"].lower():
                    results.append({"id": r["id"], "title": r["title"], "content": r["content"], "tags": tags})
            return results

    async def delete_note(self, title_or_id: str) -> bool:
        async with self.get_connection() as conn:
            q = f"%{title_or_id.lower()}%"
            cursor = await conn.execute("""
                DELETE FROM notes WHERE LOWER(id) = LOWER(?) OR LOWER(title) LIKE ?
            """, (title_or_id, q))
            await conn.commit()
            return cursor.rowcount > 0


_memory_store_instance: Optional[MemoryStore] = None


def get_memory_store() -> MemoryStore:
    global _memory_store_instance
    if _memory_store_instance is None:
        _memory_store_instance = MemoryStore()
    return _memory_store_instance

