"""WebSocket handler for real-time bidirectional agent streaming.
Implements sentence-aware chunking for natural neural TTS playback,
cancellation support, request deduplication, and structured event dispatch.
"""
from __future__ import annotations

import asyncio
import json
import re
from typing import Any, Dict, Optional, Set

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from agent.graph import run_agent_turn
from memory.store import get_memory_store
from utils.logger import get_logger

logger = get_logger(__name__)

router = APIRouter()

# Regular expressions for sentence detection & clean-up
TERMINAL_PUNCT_PATTERN = re.compile(r"^(.*?[.!?][\"']?)(?:\s+|\n+)(.*)$", re.DOTALL)
ABBREVIATION_PATTERN = re.compile(r"\b(?:e\.g|i\.e|mr|mrs|ms|dr|prof|vs|etc|\d+)\.[ \"']?$", re.IGNORECASE)
CLAUSE_PAUSE_PATTERN = re.compile(r"^(.*?[,;:\-—])\s+(.*)$", re.DOTALL)


def clean_for_speech(text: str) -> str:
    """Strip markdown symbols (*, #, `, _, ~) for pure neural spoken English."""
    cleaned = re.sub(r"[*#`_~]", "", text)
    cleaned = re.sub(r"\[([^\]]+)\]\([^)]+\)", r"\1", cleaned)
    return cleaned.strip()


class SentenceBuffer:
    """Buffers streamed tokens and yields complete spoken sentences with sub-second pacing."""

    def __init__(self):
        self._buffer = ""
        self._dispatched_count = 0

    def feed(self, chunk: str) -> list[str]:
        self._buffer += chunk
        sentences = []

        while True:
            # 1. Full sentence ending in . ! ?
            match = TERMINAL_PUNCT_PATTERN.match(self._buffer)
            if match:
                candidate = match.group(1).strip()
                if not ABBREVIATION_PATTERN.search(candidate) and len(candidate) > 0:
                    self._buffer = match.group(2)
                    cleaned = clean_for_speech(candidate)
                    if cleaned:
                        self._dispatched_count += 1
                        sentences.append(cleaned)
                    continue

            # 2. Fast-start first clause: if nothing has been spoken yet and buffer has 3+ words with a pause
            if self._dispatched_count == 0:
                words = self._buffer.strip().split()
                if len(words) >= 3:
                    c_match = CLAUSE_PAUSE_PATTERN.match(self._buffer)
                    if c_match:
                        head = c_match.group(1).strip()
                        self._buffer = c_match.group(2)
                        cleaned = clean_for_speech(head)
                        if cleaned:
                            self._dispatched_count += 1
                            sentences.append(cleaned)
                            continue

            # 3. Paragraph breaks
            if "\n\n" in self._buffer:
                parts = self._buffer.split("\n\n")
                head = parts.pop(0).strip()
                self._buffer = "\n\n".join(parts)
                cleaned = clean_for_speech(head)
                if cleaned:
                    self._dispatched_count += 1
                    sentences.append(cleaned)
                continue

            break

        return sentences

    def flush(self) -> Optional[str]:
        rem = self._buffer.strip()
        self._buffer = ""
        if rem:
            cleaned = clean_for_speech(rem)
            if cleaned:
                self._dispatched_count += 1
                return cleaned
        return None

    @property
    def dispatched_count(self) -> int:
        return self._dispatched_count


@router.websocket("/ws/{session_id}")
async def websocket_endpoint(websocket: WebSocket, session_id: str):
    await websocket.accept()
    logger.info("WebSocket connected for session: %s", session_id)

    # Active running task for cancellation
    active_task: Optional[asyncio.Task] = None
    active_request_id: Optional[str] = None
    processed_requests: Set[str] = set()

    async def send_event(event_dict: Dict[str, Any]):
        try:
            await websocket.send_text(json.dumps(event_dict))
        except Exception as e:
            logger.debug("Could not send WS event: %s", e)

    try:
        while True:
            raw_text = await websocket.receive_text()
            try:
                data = json.loads(raw_text)
            except Exception:
                continue

            msg_type = data.get("type", "")

            # 1. Heartbeat Ping / Pong
            if msg_type == "ping":
                await send_event({"type": "pong"})
                continue

            # 2. Cancellation / Barge-in
            if msg_type == "cancel":
                req_id = data.get("request_id") or active_request_id
                spoken_content = data.get("spoken_content") or data.get("spokenContent")
                if active_task and not active_task.done():
                    active_task.cancel()
                    logger.info("Cancelled active request on barge-in: %s", req_id)

                # Persist interruption state in SQLite for smart resumption
                try:
                    memory_store = get_memory_store()
                    await memory_store.mark_message_interrupted(
                        session_id=session_id,
                        spoken_content=spoken_content,
                    )
                except Exception as e:
                    logger.warning("Notice marking message interrupted in DB: %s", e)

                await send_event({
                    "type": "assistant.cancelled",
                    "request_id": req_id,
                })
                active_task = None
                continue

            # 3. New User Message
            if msg_type == "message":
                content = (data.get("content") or "").strip()
                request_id = data.get("request_id") or f"req_{int(asyncio.get_event_loop().time()*1000)}"
                config = data.get("config", {})

                if not content:
                    continue

                # Deduplication
                if request_id in processed_requests:
                    logger.debug("Ignoring duplicate request: %s", request_id)
                    continue
                processed_requests.add(request_id)

                # Cancel any previous in-flight task on this connection
                if active_task and not active_task.done():
                    active_task.cancel()

                active_request_id = request_id

                # Run conversation task
                async def handle_turn(req_id: str, prompt: str, cfg: dict):
                    await send_event({
                        "type": "assistant.started",
                        "request_id": req_id,
                    })

                    sentence_buf = SentenceBuffer()

                    async def on_chunk_cb(chunk: str):
                        sentences = sentence_buf.feed(chunk)
                        for s in sentences:
                            await send_event({
                                "type": "assistant.delta",
                                "content": s,
                                "request_id": req_id,
                            })

                    async def on_tool_start_cb(tool_name: str, args: dict):
                        await send_event({
                            "type": "tool.started",
                            "tool_name": tool_name,
                            "request_id": req_id,
                        })

                    async def on_tool_end_cb(tool_name: str, res: dict):
                        await send_event({
                            "type": "tool.completed",
                            "tool_name": tool_name,
                            "result": res.get("message") or str(res),
                            "request_id": req_id,
                        })

                    try:
                        result = await run_agent_turn(
                            user_message=prompt,
                            session_id=session_id,
                            request_id=req_id,
                            config=cfg,
                            on_chunk=on_chunk_cb,
                            on_tool_start=on_tool_start_cb,
                            on_tool_end=on_tool_end_cb,
                        )

                        # Flush remaining sentence
                        rem = sentence_buf.flush()
                        if rem:
                            await send_event({
                                "type": "assistant.delta",
                                "content": rem,
                                "request_id": req_id,
                            })
                        elif sentence_buf.dispatched_count == 0 and result.get("response"):
                            # If no sentence boundary was hit, dispatch full response directly
                            await send_event({
                                "type": "assistant.delta",
                                "content": clean_for_speech(result["response"]),
                                "request_id": req_id,
                            })

                        await send_event({
                            "type": "assistant.done",
                            "content": result.get("response", ""),
                            "request_id": req_id,
                            "model_used": result.get("model_used", "auto"),
                            "session_id": session_id,
                        })

                    except asyncio.CancelledError:
                        logger.debug("Turn cancelled by client for request: %s", req_id)
                    except Exception as err:
                        logger.error("Error handling turn: %s", err, exc_info=True)
                        await send_event({
                            "type": "assistant.error",
                            "error": str(err),
                            "request_id": req_id,
                        })

                active_task = asyncio.create_task(handle_turn(request_id, content, config))

    except WebSocketDisconnect:
        logger.info("WebSocket disconnected for session: %s", session_id)
        if active_task and not active_task.done():
            active_task.cancel()
    except Exception as exc:
        logger.error("WebSocket unhandled exception: %s", exc)
        if active_task and not active_task.done():
            active_task.cancel()

