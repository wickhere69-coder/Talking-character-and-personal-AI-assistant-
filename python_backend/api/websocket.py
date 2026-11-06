"""Real-time WebSocket bridge between the browser and Aura's brains.

Wire protocol
  client → server
    binary frame              16 kHz PCM16 mono mic audio (continuous, full-duplex)
    {"type":"message"}        typed user text → Gemini Live (or LangGraph fallback)
    {"type":"cancel"}         barge-in; carries `spoken_content` (what was actually heard)
    {"type":"live.config"}    {voice_mode, voice}
    {"type":"switch_session"} {session_id}
    {"type":"live.audio_end"} client VAD says the mic stream paused
    {"type":"ping"}
  server → client
    binary frame              24 kHz PCM16 mono Gemini voice (native_gemini_live mode)
    live.* / tool.* / assistant.* JSON events
Query params on connect: ?voice_mode=native_gemini_live|custom_voice_pack&voice=<prebuilt voice>
"""
from __future__ import annotations

import asyncio
import base64
import json
import re
import time
from typing import Any, Dict, Optional, Set, Tuple

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from agent.gemini_live_session import PREBUILT_VOICES, GeminiLiveSession
from agent.graph import run_agent_turn
from config import get_settings
from memory.store import get_memory_store
from utils.logger import get_logger

logger = get_logger(__name__)

router = APIRouter()

VOICE_MODES = ("native_gemini_live", "custom_voice_pack")

# ── Warm live-session parking ─────────────────────────────────────────────
# A Gemini Live handshake costs 0.7–7 s. When a browser socket drops (page refresh,
# React StrictMode remount, network blip) keep its live session warm briefly so the
# reconnecting tab re-attaches instantly with the conversation intact.
_PARK_SECONDS = 30.0
_parked: Dict[Tuple[str, str], Tuple[GeminiLiveSession, asyncio.Task]] = {}


def _park_live(live: GeminiLiveSession) -> None:
    key = (live.session_id, live.voice_name)
    previous = _parked.pop(key, None)
    if previous is not None:
        previous[1].cancel()
        asyncio.create_task(previous[0].close())

    async def expire() -> None:
        try:
            await asyncio.sleep(_PARK_SECONDS)
        except asyncio.CancelledError:
            return
        entry = _parked.get(key)
        if entry is not None and entry[0] is live:
            _parked.pop(key, None)
            await live.close()

    _parked[key] = (live, asyncio.create_task(expire()))
    logger.info("Parked warm Gemini Live session %s for %.0fs", live.session_id, _PARK_SECONDS)


def _claim_live(session_id: str, voice: str) -> Optional[GeminiLiveSession]:
    entry = _parked.pop((session_id, voice), None)
    if entry is None:
        return None
    live, timer = entry
    timer.cancel()
    if not live.is_active:
        asyncio.create_task(live.close())
        return None
    dropped = live.drain_events()
    logger.info("Re-attached warm Gemini Live session %s (dropped %d stale events)", session_id, dropped)
    return live

# Sentence detection for the custom voice pack (ElevenLabs reads the transcript)
TERMINAL_PUNCT_PATTERN = re.compile(r"^(.*?[.!?][\"']?)(?:\s+|\n+)(.*)$", re.DOTALL)
ABBREVIATION_PATTERN = re.compile(r"\b(?:e\.g|i\.e|mr|mrs|ms|dr|prof|vs|etc|\d+)\.[ \"']?$", re.IGNORECASE)
CLAUSE_PAUSE_PATTERN = re.compile(r"^(.*?[,;:\-—])\s+(.*)$", re.DOTALL)


def clean_for_speech(text: str) -> str:
    """Strip markdown symbols so TTS reads pure prose."""
    cleaned = re.sub(r"[*#`_~]", "", text)
    cleaned = re.sub(r"\[([^\]]+)\]\([^)]+\)", r"\1", cleaned)
    return " ".join(cleaned.split())


class SentenceBuffer:
    """Buffers streamed tokens and yields speakable sentences (fast first clause)."""

    def __init__(self) -> None:
        self._buffer = ""
        self._dispatched_count = 0

    def feed(self, chunk: str) -> list[str]:
        self._buffer += chunk
        out: list[str] = []
        while True:
            match = TERMINAL_PUNCT_PATTERN.match(self._buffer)
            if match:
                candidate = match.group(1).strip()
                if candidate and not ABBREVIATION_PATTERN.search(candidate):
                    self._buffer = match.group(2)
                    cleaned = clean_for_speech(candidate)
                    if cleaned:
                        self._dispatched_count += 1
                        out.append(cleaned)
                    continue
            if self._dispatched_count == 0:
                words = self._buffer.strip().split()
                if len(words) >= 3:
                    c_match = CLAUSE_PAUSE_PATTERN.match(self._buffer)
                    if c_match:
                        head = clean_for_speech(c_match.group(1))
                        self._buffer = c_match.group(2)
                        if head:
                            self._dispatched_count += 1
                            out.append(head)
                            continue
                if len(words) >= 7:
                    head = clean_for_speech(" ".join(words[:5]))
                    self._buffer = " ".join(words[5:])
                    if head:
                        self._dispatched_count += 1
                        out.append(head)
                        continue
            if "\n\n" in self._buffer:
                head, _, rest = self._buffer.partition("\n\n")
                self._buffer = rest
                cleaned = clean_for_speech(head)
                if cleaned:
                    self._dispatched_count += 1
                    out.append(cleaned)
                continue
            break
        return out

    def flush(self) -> Optional[str]:
        rem = clean_for_speech(self._buffer)
        self._buffer = ""
        if rem:
            self._dispatched_count += 1
            return rem
        return None

    @property
    def dispatched_count(self) -> int:
        return self._dispatched_count


class ClientConnection:
    """State for one browser WebSocket."""

    def __init__(self, websocket: WebSocket, session_id: str):
        self.ws = websocket
        self.settings = get_settings()
        self.session_id = session_id
        qp = websocket.query_params
        mode = qp.get("voice_mode") or self.settings.voice_mode
        self.voice_mode = mode if mode in VOICE_MODES else "native_gemini_live"
        voice = qp.get("voice")
        self.voice = voice if voice in PREBUILT_VOICES else self.settings.gemini_live_voice

        self.live: Optional[GeminiLiveSession] = None
        self.live_forwarder: Optional[asyncio.Task] = None
        self.live_start_task: Optional[asyncio.Task] = None
        self.text_task: Optional[asyncio.Task] = None
        self.processed_requests: Set[str] = set()
        self.live_request_id: Optional[str] = None
        self.sentence_buf = SentenceBuffer()
        self._send_lock = asyncio.Lock()
        self._closed = False

    # ── sending ──────────────────────────────────────────────────────────
    async def send_event(self, event: Dict[str, Any]) -> None:
        if self._closed:
            return
        try:
            async with self._send_lock:
                await self.ws.send_text(json.dumps(event))
        except Exception as exc:
            logger.debug("WS send_event failed: %s", exc)

    async def send_audio(self, data: bytes) -> None:
        if self._closed:
            return
        try:
            async with self._send_lock:
                await self.ws.send_bytes(data)
        except Exception as exc:
            logger.debug("WS send_bytes failed: %s", exc)

    # ── live session management ──────────────────────────────────────────
    def live_usable(self) -> bool:
        return self.live is not None and self.live.is_active

    def ensure_live(self) -> Optional[GeminiLiveSession]:
        """Create (and start connecting) a live session without blocking the caller."""
        if not self.settings.has_gemini:
            return None
        if self.live_usable():
            return self.live
        if self.live is not None:
            old = self.live
            asyncio.create_task(old.close())
        if self.live_forwarder and not self.live_forwarder.done():
            self.live_forwarder.cancel()
        self.sentence_buf = SentenceBuffer()

        claimed = _claim_live(self.session_id, self.voice)
        if claimed is not None:
            claimed.voice_mode = self.voice_mode
            self.live = claimed
            self.live_forwarder = asyncio.create_task(self._forward_live(claimed))
            if claimed.is_connected:
                asyncio.create_task(self.send_event({
                    "type": "live.connected", "resumed": True, "model": claimed.model, "voice": claimed.voice_name,
                }))
            return claimed

        self.live = GeminiLiveSession(self.session_id, voice_mode=self.voice_mode, voice_name=self.voice)
        self.live_forwarder = asyncio.create_task(self._forward_live(self.live))
        self.live_start_task = asyncio.create_task(self._start_live(self.live))
        return self.live

    async def _start_live(self, live: GeminiLiveSession) -> None:
        try:
            ok = await live.start()
            if not ok:
                logger.warning("Gemini Live did not connect within the deadline (still retrying)")
        except Exception as exc:
            logger.warning("Gemini Live start failed: %s", exc)
            await self.send_event({"type": "live.error", "error": str(exc)[:200]})

    async def restart_live(self) -> None:
        old = self.live
        self.live = None
        if self.live_forwarder and not self.live_forwarder.done():
            self.live_forwarder.cancel()
        if old is not None:
            await old.close()
        self.ensure_live()

    async def _forward_live(self, live: GeminiLiveSession) -> None:
        custom = lambda: self.voice_mode == "custom_voice_pack"  # noqa: E731
        try:
            while True:
                ev = await live.get_next_event()
                if live is not self.live:
                    return
                t = ev.get("type")

                if t == "live.audio":
                    if not custom():
                        await self.send_audio(ev["data"])
                    continue

                if t == "live.transcript" and custom():
                    for sentence in self.sentence_buf.feed(ev.get("text", "")):
                        await self.send_event({"type": "assistant.delta", "content": sentence, "request_id": self.live_request_id or "live_turn"})
                elif t == "live.interrupted":
                    self.sentence_buf = SentenceBuffer()
                    if custom():
                        await self.send_event({"type": "assistant.cancelled", "request_id": self.live_request_id or "live_turn"})
                    self.live_request_id = None
                elif t == "live.turn_complete":
                    if custom():
                        rem = self.sentence_buf.flush()
                        if rem:
                            await self.send_event({"type": "assistant.delta", "content": rem, "request_id": self.live_request_id or "live_turn"})
                        await self.send_event({
                            "type": "assistant.done",
                            "content": ev.get("full_text", ""),
                            "request_id": self.live_request_id or "live_turn",
                            "model_used": live.model,
                            "session_id": self.session_id,
                        })
                    self.sentence_buf = SentenceBuffer()
                    ev = {**ev, "request_id": self.live_request_id}
                    self.live_request_id = None

                await self.send_event(ev)
        except asyncio.CancelledError:
            pass
        except Exception as exc:
            logger.warning("live forwarder stopped: %s", exc)

    # ── text turns ───────────────────────────────────────────────────────
    async def handle_message(self, data: Dict[str, Any]) -> None:
        content = (data.get("content") or "").strip()
        request_id = data.get("request_id") or f"req_{int(time.time() * 1000)}"
        cfg = data.get("config") or {}
        if not content or request_id in self.processed_requests:
            return
        self.processed_requests.add(request_id)
        if self.text_task and not self.text_task.done():
            self.text_task.cancel()

        try:
            await get_memory_store().add_message(session_id=self.session_id, role="user", content=content)
        except Exception as exc:
            logger.debug("Could not persist user message: %s", exc)

        await self.send_event({"type": "assistant.started", "request_id": request_id})

        if cfg.get("use_live", True) and self.settings.has_gemini:
            live = self.ensure_live()
            if live is not None:
                live.note_typed_user_message()
                if await live.send_text(content):
                    self.live_request_id = request_id
                    await self.send_event({"type": "live.text_accepted", "request_id": request_id, "voice_mode": self.voice_mode})
                    logger.info("Typed turn routed to Gemini Live: %s", content[:60])
                    return
                logger.warning("Gemini Live unavailable for typed turn — using LangGraph")

        self.text_task = asyncio.create_task(self._run_langgraph(request_id, content, cfg))

    async def _run_langgraph(self, req_id: str, prompt: str, cfg: dict) -> None:
        buf = SentenceBuffer()

        async def on_chunk(chunk: str) -> None:
            for s in buf.feed(chunk):
                await self.send_event({"type": "assistant.delta", "content": s, "request_id": req_id})

        async def on_tool_start(name: str, args: dict) -> None:
            await self.send_event({"type": "tool.started", "tool_name": name, "request_id": req_id})

        async def on_tool_end(name: str, res: dict) -> None:
            msg = res.get("message") if isinstance(res, dict) else str(res)
            await self.send_event({"type": "tool.completed", "tool_name": name, "result": (msg or "")[:300], "request_id": req_id})

        try:
            result = await run_agent_turn(
                user_message=prompt,
                session_id=self.session_id,
                request_id=req_id,
                config=cfg,
                on_chunk=on_chunk,
                on_tool_start=on_tool_start,
                on_tool_end=on_tool_end,
                persist_user=False,  # already saved when the message arrived
            )
            rem = buf.flush()
            if rem:
                await self.send_event({"type": "assistant.delta", "content": rem, "request_id": req_id})
            elif buf.dispatched_count == 0 and result.get("response"):
                await self.send_event({"type": "assistant.delta", "content": clean_for_speech(result["response"]), "request_id": req_id})
            await self.send_event({
                "type": "assistant.done",
                "content": result.get("response", ""),
                "request_id": req_id,
                "model_used": result.get("model_used", "auto"),
                "session_id": self.session_id,
            })
        except asyncio.CancelledError:
            logger.debug("LangGraph turn cancelled: %s", req_id)
        except Exception as exc:
            logger.error("LangGraph turn failed: %s", exc, exc_info=True)
            await self.send_event({"type": "assistant.error", "error": str(exc), "request_id": req_id})

    # ── control messages ──────────────────────────────────────────────────
    async def handle_cancel(self, data: Dict[str, Any]) -> None:
        req_id = data.get("request_id")
        spoken = data.get("spoken_content") or data.get("spokenContent") or ""
        if self.text_task and not self.text_task.done():
            self.text_task.cancel()
            try:
                await get_memory_store().mark_message_interrupted(session_id=self.session_id, spoken_content=spoken)
            except Exception as exc:
                logger.debug("mark_message_interrupted notice: %s", exc)
        if self.live is not None:
            await self.live.note_client_spoken(spoken)
        self.sentence_buf = SentenceBuffer()
        self.live_request_id = None
        await self.send_event({"type": "assistant.cancelled", "request_id": req_id})

    async def handle_config(self, data: Dict[str, Any]) -> None:
        mode = data.get("voice_mode")
        voice = data.get("voice")
        if mode in VOICE_MODES and mode != self.voice_mode:
            self.voice_mode = mode
            if self.live is not None:
                self.live.voice_mode = mode
            logger.info("Voice mode -> %s", mode)
        if voice in PREBUILT_VOICES and voice != self.voice:
            self.voice = voice
            logger.info("Live voice -> %s (reconnecting)", voice)
            if self.live is not None:
                await self.restart_live()

    async def handle_switch_session(self, new_id: Optional[str]) -> None:
        if not new_id or new_id == self.session_id:
            return
        self.session_id = new_id
        if self.text_task and not self.text_task.done():
            self.text_task.cancel()
        logger.info("Switched to session %s — re-seeding live context", new_id)
        if self.live is not None:
            await self.restart_live()

    async def close(self) -> None:
        self._closed = True
        for task in (self.text_task, self.live_forwarder):
            if task and not task.done():
                task.cancel()
        live, self.live = self.live, None
        if live is not None:
            if live.is_active:
                await live.flush_persistence()
                _park_live(live)  # keeps connecting in the background if it hadn't yet
            else:
                if self.live_start_task and not self.live_start_task.done():
                    self.live_start_task.cancel()
                await live.close()


@router.websocket("/ws/{session_id}")
async def websocket_endpoint(websocket: WebSocket, session_id: str):
    await websocket.accept()
    conn = ClientConnection(websocket, session_id)
    settings = conn.settings
    logger.info("WebSocket connected: session=%s voice_mode=%s voice=%s", session_id, conn.voice_mode, conn.voice)

    await conn.send_event({
        "type": "live.ready",
        "voice_mode": conn.voice_mode,
        "default_voice_mode": settings.voice_mode,
        "model": settings.gemini_live_model,
        "voice": conn.voice,
        "voices": PREBUILT_VOICES,
        "has_gemini": settings.has_gemini,
        "text_models": settings.gemini_model_chain,
    })

    # Pre-warm the live connection so the first utterance has no handshake cost.
    conn.ensure_live()

    try:
        while True:
            msg = await websocket.receive()
            if msg.get("type") == "websocket.disconnect":
                break

            raw_bytes = msg.get("bytes")
            if raw_bytes:
                live = conn.ensure_live()
                if live is not None:
                    await live.send_audio_chunk(raw_bytes)
                continue

            raw_text = msg.get("text") or ""
            if not raw_text:
                continue
            try:
                data = json.loads(raw_text)
            except ValueError:
                continue
            t = data.get("type", "")

            if t == "ping":
                await conn.send_event({"type": "pong", "t": data.get("t")})
            elif t in ("audio", "live.audio"):  # legacy base64 mic frames
                b64 = data.get("pcm") or data.get("audio") or ""
                live = conn.ensure_live()
                if b64 and live is not None:
                    try:
                        await live.send_audio_chunk(base64.b64decode(b64))
                    except ValueError:
                        pass
            elif t in ("live.audio_end", "audio_stream_end"):
                if conn.live is not None:
                    await conn.live.send_audio_stream_end()
            elif t == "live.connect":
                conn.ensure_live()
            elif t == "live.config":
                await conn.handle_config(data)
            elif t == "switch_session":
                await conn.handle_switch_session(data.get("session_id"))
            elif t == "cancel":
                await conn.handle_cancel(data)
            elif t == "message":
                await conn.handle_message(data)
    except WebSocketDisconnect:
        pass
    except Exception as exc:
        logger.error("WebSocket error: %s", exc, exc_info=True)
    finally:
        logger.info("WebSocket closed: session=%s", conn.session_id)
        await conn.close()
