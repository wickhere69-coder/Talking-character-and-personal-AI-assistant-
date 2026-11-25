"""REST endpoints for session management, memory, tasks, and system health."""
from __future__ import annotations

import asyncio
import json
import os
from pathlib import Path
import re
import secrets
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from agent.graph import run_agent_turn
from agent.providers.provider_manager import ProviderManager
from agent.tools import TOOL_DEFINITIONS
from api.websocket import SentenceBuffer, clean_for_speech
from config import get_settings
from memory.store import get_memory_store
from utils.logger import get_logger
from utils.sanitizer import sanitize_string
from utils.security import require_admin_auth, sanitize_error_message, validate_identifier

logger = get_logger(__name__)

router = APIRouter()


# ── Pydantic Request Models ──────────────────────────────────────────────

class ChatRequest(BaseModel):
    message: str = Field(..., min_length=1, max_length=8000)
    config: Optional[Dict[str, Any]] = None
    sessionId: Optional[str] = Field(default=None, max_length=128)


class SessionCreateRequest(BaseModel):
    title: Optional[str] = Field(default=None, max_length=200)
    topic: Optional[str] = Field(default=None, max_length=120)


class SessionUpdateRequest(BaseModel):
    title: Optional[str] = Field(default=None, max_length=200)
    topic: Optional[str] = Field(default=None, max_length=120)
    summary: Optional[str] = Field(default=None, max_length=4000)
    establishedFacts: Optional[List[str]] = None
    pinned: Optional[bool] = None
    archived: Optional[bool] = None


class MessageCreateRequest(BaseModel):
    role: str = Field(..., min_length=1, max_length=32)
    content: str = Field(..., min_length=1, max_length=16000)
    extra: Optional[Dict[str, Any]] = None


class MemoryCreateRequest(BaseModel):
    key: str = Field(..., min_length=1, max_length=128)
    value: str = Field(..., min_length=1, max_length=4000)
    category: Optional[str] = Field(default="fact", max_length=64)


class SaveKeyRequest(BaseModel):
    provider: str = Field(..., min_length=1, max_length=32)
    apiKey: str = Field(..., max_length=512)


# ── Health & Key Status ──────────────────────────────────────────────────

@router.get("/health")
@router.get("/api/agent/health")
async def health_check():
    store = get_memory_store()
    sessions = await store.list_sessions(include_archived=True)
    mgr = ProviderManager()
    h = mgr.health_check()
    return {
        "status": "ok",
        "connected": True,
        "model": "Python LangGraph FastAPI",
        "providers": h,
        "toolsCount": len(TOOL_DEFINITIONS),
        "tools": [{"name": t["name"], "description": t["description"]} for t in TOOL_DEFINITIONS],
        "sessionCount": len(sessions),
    }


@router.get("/api/agent/key-status")
async def key_status():
    mgr = ProviderManager()
    return mgr.key_status()


@router.post("/api/agent/save-key", dependencies=[Depends(require_admin_auth)])
async def save_key(req: SaveKeyRequest):
    provider = req.provider.lower().strip()
    # Strip CR/LF/NUL to strictly prevent .env newline injection
    key = re.sub(r"[\r\n\x00]", "", req.apiKey).strip()

    env_map = {
        "gemini": "GEMINI_API_KEY",
        "grok": "GROK_API_KEY",
        "xai": "XAI_API_KEY",
    }
    env_var = env_map.get(provider)
    if not env_var:
        raise HTTPException(status_code=400, detail=f"Unsupported provider: {provider}")

    os.environ[env_var] = key

    # Persist to local .env
    env_path = Path(__file__).resolve().parents[1] / ".env"
    try:
        lines = []
        if env_path.exists():
            lines = env_path.read_text(encoding="utf-8").splitlines()

        found = False
        new_lines = []
        for line in lines:
            if line.startswith(f"{env_var}="):
                new_lines.append(f"{env_var}={key}")
                found = True
            else:
                new_lines.append(line)
        if not found:
            new_lines.append(f"{env_var}={key}")

        env_path.write_text("\n".join(new_lines) + "\n", encoding="utf-8")
        get_settings.cache_clear()
        logger.info("Saved %s to backend environment config", env_var)
    except Exception as e:
        logger.warning("Could not persist key to .env: %s", type(e).__name__)

    return {"success": True, "provider": provider, "configured": bool(key)}


# ── Sessions ─────────────────────────────────────────────────────────────

@router.get("/api/agent/sessions")
async def list_sessions(includeArchived: bool = False, search: Optional[str] = None):
    store = get_memory_store()
    sessions = await store.list_sessions(include_archived=includeArchived, search=search)
    return {"sessions": sessions}


@router.post("/api/agent/sessions", status_code=201)
async def create_session(req: SessionCreateRequest):
    store = get_memory_store()
    session = await store.create_session(title=req.title, topic=req.topic)
    return {"session": session}


@router.get("/api/agent/sessions/{session_id}")
async def get_session(session_id: str):
    safe_id = validate_identifier(session_id, "session_id")
    store = get_memory_store()
    data = await store.get_session(safe_id)
    if not data:
        raise HTTPException(status_code=404, detail="Session not found.")
    return data


@router.patch("/api/agent/sessions/{session_id}")
async def update_session(session_id: str, req: SessionUpdateRequest):
    safe_id = validate_identifier(session_id, "session_id")
    store = get_memory_store()
    updates = req.model_dump(exclude_unset=True)
    updated = await store.update_session(safe_id, **updates)
    if not updated:
        raise HTTPException(status_code=404, detail="Session not found.")
    return {"session": updated}


@router.delete("/api/agent/sessions/{session_id}")
async def delete_session(session_id: str):
    safe_id = validate_identifier(session_id, "session_id")
    store = get_memory_store()
    ok = await store.delete_session(safe_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Session not found.")
    return {"success": True, "id": safe_id}


@router.get("/api/agent/sessions/{session_id}/messages")
async def get_messages(session_id: str, limit: Optional[int] = None):
    safe_id = validate_identifier(session_id, "session_id")
    store = get_memory_store()
    msgs = await store.get_messages(safe_id, limit=limit)
    return {"messages": msgs}


@router.post("/api/agent/sessions/{session_id}/messages", status_code=201)
async def add_message(session_id: str, req: MessageCreateRequest):
    safe_id = validate_identifier(session_id, "session_id")
    role = req.role.strip().lower()
    if role not in ("user", "assistant", "system"):
        raise HTTPException(status_code=400, detail="Invalid message role.")
    store = get_memory_store()
    extra = req.extra or {}
    msg = await store.add_message(safe_id, role, sanitize_string(req.content, 16000), **extra)
    return {"message": msg}


# ── Memory & Preferences ──────────────────────────────────────────────────

@router.get("/api/agent/memory")
async def list_memories(category: Optional[str] = None):
    store = get_memory_store()
    memories = await store.list_memories(category=category)
    return {"memories": memories}


@router.post("/api/agent/memory")
async def add_memory(req: MemoryCreateRequest):
    store = get_memory_store()
    mem = await store.remember(
        sanitize_string(req.key, 128),
        sanitize_string(req.value, 4000),
        sanitize_string(req.category or "fact", 64) or "fact",
    )
    return mem


@router.delete("/api/agent/memory/{key}")
async def delete_memory(key: str):
    safe_key = validate_identifier(key, "memory_key")
    store = get_memory_store()
    deleted = await store.delete_memory(safe_key)
    return {"success": deleted}


# ── Tasks & Notes ─────────────────────────────────────────────────────────

@router.get("/api/agent/tasks")
async def list_tasks(status: Optional[str] = None):
    store = get_memory_store()
    tasks = await store.list_tasks(status=status)
    return {"tasks": tasks}


@router.get("/api/agent/notes")
async def list_notes(tag: Optional[str] = None):
    store = get_memory_store()
    notes = await store.list_notes(tag=tag)
    return {"notes": notes}


# ── HTTP Chat Fallback (for non-WS clients) ──────────────────────────────

@router.post("/api/agent/chat")
async def http_chat(req: ChatRequest):
    clean_msg = sanitize_string(req.message, 4000)
    store = get_memory_store()

    session_id = validate_identifier(req.sessionId, "sessionId") if req.sessionId else None
    if not session_id:
        sess = await store.create_session("Conversation", "General")
        session_id = sess["id"]

    request_id = f"req_http_{secrets.token_hex(4)}"

    try:
        result = await run_agent_turn(
            user_message=clean_msg,
            session_id=session_id,
            request_id=request_id,
            config=req.config or {},
        )
        return {
            "response": result.get("response", ""),
            "status": "idle",
            "sessionId": session_id,
            "modelUsed": result.get("model_used", "auto"),
            "toolsExecuted": result.get("tool_results", []),
        }
    except Exception as exc:
        logger.error("HTTP chat error: %s", exc, exc_info=True)
        safe_err = sanitize_error_message(exc)
        return {
            "response": f"I ran into an unexpected error: {safe_err}",
            "status": "error",
            "sessionId": session_id,
            "modelUsed": "error_handler",
            "error": safe_err,
        }


# ── HTTP Server-Sent Events (SSE) Streaming Fallback ─────────────────────

@router.post("/api/agent/stream")
async def sse_agent_stream(req: ChatRequest):
    clean_msg = sanitize_string(req.message, 4000)
    store = get_memory_store()

    session_id = validate_identifier(req.sessionId, "sessionId") if req.sessionId else None
    if not session_id:
        sess = await store.create_session("Conversation", "General")
        session_id = sess["id"]

    request_id = f"req_sse_{secrets.token_hex(4)}"

    async def event_generator():
        queue: asyncio.Queue[Optional[str]] = asyncio.Queue()
        sentence_buf = SentenceBuffer()

        async def on_chunk_cb(chunk: str):
            sentences = sentence_buf.feed(chunk)
            for s in sentences:
                await queue.put(json.dumps({"type": "sentence", "text": s}))
            await queue.put(json.dumps({"type": "chunk", "text": chunk}))

        async def on_tool_start_cb(name: str, args: dict):
            await queue.put(json.dumps({"type": "tool_start", "name": name}))

        async def on_tool_end_cb(name: str, res: dict):
            await queue.put(json.dumps({"type": "tool_end", "name": name, "result": res}))

        async def run_turn():
            try:
                res = await run_agent_turn(
                    user_message=clean_msg,
                    session_id=session_id,
                    request_id=request_id,
                    config=req.config or {},
                    on_chunk=on_chunk_cb,
                    on_tool_start=on_tool_start_cb,
                    on_tool_end=on_tool_end_cb,
                )
                rem = sentence_buf.flush()
                if rem:
                    await queue.put(json.dumps({"type": "sentence", "text": rem}))
                elif sentence_buf.dispatched_count == 0 and res.get("response"):
                    await queue.put(json.dumps({"type": "sentence", "text": clean_for_speech(res["response"])}))

                await queue.put(json.dumps({
                    "type": "done",
                    "response": res.get("response", ""),
                    "modelUsed": res.get("model_used", "auto"),
                    "sessionId": session_id,
                }))
            except Exception as e:
                logger.error("SSE stream error: %s", e, exc_info=True)
                await queue.put(json.dumps({"type": "error", "error": sanitize_error_message(e)}))
            finally:
                await queue.put(None)

        asyncio.create_task(run_turn())
        while True:
            item = await queue.get()
            if item is None:
                break
            yield f"data: {item}\n\n"

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


