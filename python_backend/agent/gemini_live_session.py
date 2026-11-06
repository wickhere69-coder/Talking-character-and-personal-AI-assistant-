"""Gemini 3.8 Live — persistent, full-duplex voice session.

Key behaviours (each verified against the live API):
  * ``session.receive()`` ends after every completed turn, so we loop it for the life of
    the connection. (The previous single loop silently killed the session after the first
    reply, forcing a cold reconnect with no memory on every turn.)
  * Tools are declared BLOCKING with structured ``{status, message}`` responses. On
    gemini-3.8-live, NON_BLOCKING calls never speak their result.
  * Server VAD is tuned for quick barge-in and snappy end-of-turn; context-window
    compression lifts the 15-minute cap; resumption handles + GoAway handling give
    seamless reconnects across the ~10-minute connection limit.
  * Each new connection is seeded with Aura's persona plus the session's memory.
"""
from __future__ import annotations

import asyncio
import collections
import json
import time
from typing import Any, Deque, Dict, List, Optional

from google import genai
from google.genai import types

from agent.persona import build_live_system_instruction
from agent.tools import LIVE_TOOL_NAMES, TOOL_REGISTRY
from config import get_settings
from memory.store import get_memory_store
from utils.logger import get_logger

logger = get_logger(__name__)

PREBUILT_VOICES = [
    "Aoede", "Leda", "Kore", "Sulafat", "Achernar", "Despina", "Callirrhoe", "Autonoe", "Erinome",
    "Laomedeia", "Pulcherrima", "Vindemiatrix", "Zephyr", "Puck", "Charon", "Fenrir", "Orus",
    "Enceladus", "Iapetus", "Umbriel", "Algieba", "Algenib", "Rasalgethi", "Alnilam", "Schedar",
    "Gacrux", "Achird", "Zubenelgenubi", "Sadachbia", "Sadaltager",
]

DEEP_THINK_DECLARATION = {
    "name": "deep_think",
    "description": (
        "Hand a genuinely hard problem (multi-step math, code, careful analysis, detailed planning) to a "
        "stronger reasoning engine and get back a verified answer to explain in your own words. "
        "Do not use for casual chat or simple facts."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "question": {"type": "string", "description": "The full problem, self-contained."},
            "context": {"type": "string", "description": "Relevant details from the conversation, if any."},
        },
        "required": ["question"],
    },
}

_MAX_RECONNECT_ATTEMPTS = 6
# Tools whose result the model never needs to continue speaking.
_FAST_ACK_TOOLS = {"remember_about_user"}
_AUDIO_BUFFER_BYTES = 16000 * 2  # ~1s of 16 kHz PCM16 kept while reconnecting


def _sensitivity(kind: str, value: str):
    high = (value or "").lower() == "high"
    if kind == "start":
        return types.StartSensitivity.START_SENSITIVITY_HIGH if high else types.StartSensitivity.START_SENSITIVITY_LOW
    return types.EndSensitivity.END_SENSITIVITY_HIGH if high else types.EndSensitivity.END_SENSITIVITY_LOW


def _join_piece(existing: str, piece: str) -> str:
    """Transcription chunks carry their own spacing — except across a pause (e.g. a tool
    call), where "there." + "It's" would glue into "there.It's"."""
    if existing and piece and not existing[-1].isspace() and not piece[0].isspace():
        last, first = existing[-1], piece[0]
        if last in ".!?…" and (first.isupper() or first in "\"'("):
            return " " + piece
        if last in ",;:" and first.isalpha():
            return " " + piece
    return piece


def _tool_response_payload(result: Any) -> Dict[str, Any]:
    if not isinstance(result, dict):
        return {"status": "ok", "result": str(result)[:3000]}
    ok = result.get("success", True)
    status = result.get("status") or ("ok" if ok else "error")
    msg = result.get("message") or result.get("error") or result.get("data") or ""
    if not isinstance(msg, str):
        msg = json.dumps(msg, default=str)
    payload: Dict[str, Any] = {"status": status, "result": msg[:3000], "retryable": False}
    if status != "ok":
        payload["guidance"] = "Tell the user briefly and naturally; don't retry the same call."
    return payload


class GeminiLiveSession:
    """One persistent Gemini Live conversation bound to an app session id."""

    def __init__(self, session_id: str, voice_mode: Optional[str] = None, voice_name: Optional[str] = None):
        self.settings = get_settings()
        self.session_id = session_id
        self.voice_mode = voice_mode or self.settings.voice_mode
        self.voice_name = voice_name if voice_name in PREBUILT_VOICES else self.settings.gemini_live_voice
        self.model = self.settings.gemini_live_model

        self._client: Optional[genai.Client] = None
        self._session: Any = None
        self._events: asyncio.Queue[Dict[str, Any]] = asyncio.Queue()
        self._supervisor: Optional[asyncio.Task] = None
        self._connected = asyncio.Event()
        self._closing = False
        self._failed = False
        self._resume_handle: Optional[str] = None
        self._reconnect_requested = False
        self._pending_audio: Deque[bytes] = collections.deque()
        self._pending_audio_bytes = 0
        self._tool_tasks: Dict[str, asyncio.Task] = {}

        # Per-turn transcript state (for memory persistence)
        self._user_text = ""
        self._model_text = ""
        self._model_turn_open = False
        self._client_spoken: Optional[str] = None
        self._last_assistant_msg_id: Optional[str] = None
        self._persist_tasks: set = set()
        self._persist_lock = asyncio.Lock()
        self._discarding_turn = False  # client cancelled this turn; drop its remaining output

    # ── lifecycle ─────────────────────────────────────────────────────────
    @property
    def is_active(self) -> bool:
        return not self._closing and not self._failed

    @property
    def is_connected(self) -> bool:
        return self._connected.is_set() and self._session is not None

    @property
    def is_extended_thinking(self) -> bool:
        return "extended-thinking" in self.model.lower()

    async def start(self, wait_timeout: float = 8.0) -> bool:
        """Start the supervisor and wait for the first connection."""
        if not self.settings.has_gemini:
            raise RuntimeError("GEMINI_API_KEY is not configured for Gemini Live.")
        if self._supervisor is None or self._supervisor.done():
            self._client = genai.Client(api_key=self.settings.gemini_api_key)
            self._supervisor = asyncio.create_task(self._supervise(), name=f"live-{self.session_id}")
        try:
            await asyncio.wait_for(self._connected.wait(), timeout=wait_timeout)
        except asyncio.TimeoutError:
            return False
        return True

    async def close(self) -> None:
        self._closing = True
        for task in list(self._tool_tasks.values()):
            task.cancel()
        self._tool_tasks.clear()
        await self._persist_turn(interrupted=self._model_turn_open)
        if self._supervisor and not self._supervisor.done():
            self._supervisor.cancel()
            try:
                await self._supervisor
            except (asyncio.CancelledError, Exception):
                pass
        if self._persist_tasks:
            await asyncio.gather(*list(self._persist_tasks), return_exceptions=True)
        self._session = None
        self._connected.clear()
        logger.info("Closed Gemini Live session %s", self.session_id)

    async def get_next_event(self) -> Dict[str, Any]:
        return await self._events.get()

    async def flush_persistence(self) -> None:
        """Wait for queued conversation writes to land in the database."""
        if self._persist_tasks:
            await asyncio.gather(*list(self._persist_tasks), return_exceptions=True)

    def drain_events(self) -> int:
        """Drop queued events (e.g. audio produced while no browser was attached)."""
        n = 0
        while not self._events.empty():
            self._events.get_nowait()
            n += 1
        return n

    async def _emit(self, event: Dict[str, Any]) -> None:
        await self._events.put(event)

    # ── config ───────────────────────────────────────────────────────────
    def _build_tools(self) -> List[types.Tool]:
        behavior = types.Behavior.NON_BLOCKING if self.is_extended_thinking else types.Behavior.BLOCKING
        decls: List[types.FunctionDeclaration] = []
        defs = [TOOL_REGISTRY[n] for n in LIVE_TOOL_NAMES if n in TOOL_REGISTRY] + [DEEP_THINK_DECLARATION]
        for d in defs:
            try:
                decls.append(types.FunctionDeclaration(
                    name=d["name"],
                    description=d.get("description", ""),
                    parameters=d.get("parameters") or {"type": "object", "properties": {}},
                    behavior=behavior,
                ))
            except Exception as exc:
                logger.warning("Skipping live tool %s: %s", d.get("name"), exc)
        return [types.Tool(function_declarations=decls)] if decls else []

    async def _build_config(self) -> types.LiveConnectConfig:
        s = self.settings
        instruction = await build_live_system_instruction(
            self.session_id, get_memory_store(), history_turns=s.live_history_turns
        )
        kwargs: Dict[str, Any] = dict(
            response_modalities=[types.Modality.AUDIO],
            speech_config=types.SpeechConfig(
                voice_config=types.VoiceConfig(
                    prebuilt_voice_config=types.PrebuiltVoiceConfig(voice_name=self.voice_name)
                )
            ),
            input_audio_transcription=types.AudioTranscriptionConfig(),
            output_audio_transcription=types.AudioTranscriptionConfig(),
            realtime_input_config=types.RealtimeInputConfig(
                automatic_activity_detection=types.AutomaticActivityDetection(
                    disabled=False,
                    start_of_speech_sensitivity=_sensitivity("start", s.live_vad_start_sensitivity),
                    end_of_speech_sensitivity=_sensitivity("end", s.live_vad_end_sensitivity),
                    prefix_padding_ms=s.live_vad_prefix_padding_ms,
                    silence_duration_ms=s.live_vad_silence_ms,
                ),
                activity_handling=types.ActivityHandling.START_OF_ACTIVITY_INTERRUPTS,
            ),
            context_window_compression=types.ContextWindowCompressionConfig(sliding_window=types.SlidingWindow()),
            session_resumption=types.SessionResumptionConfig(handle=self._resume_handle),
            system_instruction=types.Content(parts=[types.Part(text=instruction)]),
            tools=self._build_tools() or None,
        )
        # thinking_config is rejected by gemini-3.8-live (it reasons natively);
        # only the extended-thinking variant accepts a level.
        if self.is_extended_thinking:
            level = (s.gemini_live_thinking_level or "low").lower()
            kwargs["thinking_config"] = types.ThinkingConfig(
                thinking_level=level if level in ("low", "medium", "high") else "low"
            )
        return types.LiveConnectConfig(**kwargs)

    # ── connection supervisor ────────────────────────────────────────────
    async def _supervise(self) -> None:
        attempts = 0
        while not self._closing:
            resumed = bool(self._resume_handle)
            try:
                config = await self._build_config()
                t0 = time.perf_counter()
                async with self._client.aio.live.connect(model=self.model, config=config) as session:
                    self._session = session
                    self._connected.set()
                    attempts = 0
                    logger.info(
                        "Gemini Live connected (%s, voice=%s, %s) in %.0f ms for session %s",
                        self.model, self.voice_name, "resumed" if resumed else "fresh",
                        (time.perf_counter() - t0) * 1000, self.session_id,
                    )
                    await self._emit({"type": "live.connected", "resumed": resumed, "model": self.model, "voice": self.voice_name})
                    await self._flush_pending_audio()
                    await self._receive_forever(session)
            except asyncio.CancelledError:
                break
            except Exception as exc:  # noqa: BLE001
                if self._closing:
                    break
                text = str(exc)
                low = text.lower()
                logger.warning("Gemini Live connection ended: %s", text[:200])
                if resumed and ("1007" in text or "invalid" in low or "handle" in low or "already connected" in low):
                    # Stale handle, or Google still holds the dead socket (1008 "already connected
                    # to an existing client") — don't wait it out; start a fresh memory-seeded session.
                    self._resume_handle = None
                    attempts = max(0, attempts - 1)
                attempts += 1
                if attempts > _MAX_RECONNECT_ATTEMPTS:
                    self._failed = True
                    await self._emit({"type": "live.error", "error": f"Live voice is unavailable: {text[:160]}", "fatal": True})
                    break
            finally:
                self._session = None
                self._connected.clear()
                self._discarding_turn = False
                for task in list(self._tool_tasks.values()):
                    task.cancel()
                self._tool_tasks.clear()

            if self._closing:
                break
            if self._model_turn_open:
                await self._persist_turn(interrupted=True)
            await self._emit({"type": "live.reconnecting", "attempt": attempts})
            await asyncio.sleep(min(0.25 * (2 ** max(0, attempts - 1)), 4.0) if attempts else 0.05)

    async def _receive_forever(self, session: Any) -> None:
        """receive() yields one completed interaction; loop it for the connection's life."""
        while not self._closing:
            async for message in session.receive():
                await self._handle_message(message)
            if self._reconnect_requested and not self._model_turn_open:
                self._reconnect_requested = False
                logger.info("Rotating Gemini Live connection after GoAway (handle=%s)", bool(self._resume_handle))
                return

    # ── inbound messages ─────────────────────────────────────────────────
    async def _handle_message(self, message: Any) -> None:
        upd = getattr(message, "session_resumption_update", None)
        if upd is not None and getattr(upd, "resumable", False) and getattr(upd, "new_handle", None):
            self._resume_handle = upd.new_handle

        go_away = getattr(message, "go_away", None)
        if go_away is not None:
            logger.info("Gemini Live GoAway received (time_left=%s)", getattr(go_away, "time_left", None))
            self._reconnect_requested = True
            await self._emit({"type": "live.go_away"})

        content = getattr(message, "server_content", None)
        if content is not None:
            await self._handle_server_content(content)

        tool_call = getattr(message, "tool_call", None)
        if tool_call is not None:
            for call in getattr(tool_call, "function_calls", None) or []:
                call_id = getattr(call, "id", None) or f"call_{call.name}_{time.time_ns()}"
                self._tool_tasks[call_id] = asyncio.create_task(self._run_tool(call_id, call))

        cancellation = getattr(message, "tool_call_cancellation", None)
        if cancellation is not None:
            ids = list(getattr(cancellation, "ids", None) or [])
            for cid in ids:
                task = self._tool_tasks.pop(cid, None)
                if task:
                    task.cancel()
            await self._emit({"type": "tool.cancelled", "ids": ids})

    async def _handle_server_content(self, content: Any) -> None:
        if getattr(content, "interrupted", False):
            await self._emit({"type": "live.interrupted"})  # first: the browser must stop audio now
            if self._model_turn_open:
                await self._persist_turn(interrupted=True, wait=True)
            self._discarding_turn = False

        interim = getattr(content, "interim_input_transcription", None)
        if interim is not None and getattr(interim, "text", None):
            await self._emit({"type": "live.user_transcript_interim", "text": interim.text})

        user_tx = getattr(content, "input_transcription", None)
        if user_tx is not None and getattr(user_tx, "text", None):
            piece = _join_piece(self._user_text, user_tx.text)
            self._user_text += piece
            await self._emit({"type": "live.user_transcript", "text": piece, "full": " ".join(self._user_text.split())})

        if self._discarding_turn:
            # Remainder of a reply the user already cut off: never re-open it (the browser
            # would resume playing it), just wait for Gemini to close the turn.
            if getattr(content, "turn_complete", False):
                self._discarding_turn = False
                self._model_text = ""
            return

        model_turn = getattr(content, "model_turn", None)
        if model_turn is not None:
            for part in getattr(model_turn, "parts", None) or []:
                inline = getattr(part, "inline_data", None)
                if inline is not None and getattr(inline, "data", None):
                    await self._open_model_turn()
                    await self._emit({"type": "live.audio", "data": inline.data})

        out_tx = getattr(content, "output_transcription", None)
        if out_tx is not None and getattr(out_tx, "text", None):
            await self._open_model_turn()
            piece = _join_piece(self._model_text, out_tx.text)
            self._model_text += piece
            await self._emit({"type": "live.transcript", "text": piece})

        if getattr(content, "generation_complete", False):
            await self._emit({"type": "live.generation_complete"})

        if getattr(content, "turn_complete", False):
            full = " ".join(self._model_text.split())
            if self._model_turn_open:
                await self._persist_turn(interrupted=False, wait=True)
            await self._emit({"type": "live.turn_complete", "full_text": full})

    async def _open_model_turn(self) -> None:
        if not self._model_turn_open:
            self._model_turn_open = True
            self._client_spoken = None
            await self._emit({"type": "live.turn_started", "user_text": " ".join(self._user_text.split())})

    # ── tools ────────────────────────────────────────────────────────────
    async def _run_tool(self, call_id: str, call: Any) -> None:
        name = getattr(call, "name", "") or ""
        args = dict(getattr(call, "args", None) or {})
        await self._emit({"type": "tool.started", "tool_name": name, "args": args})
        started = time.perf_counter()
        try:
            if name in _FAST_ACK_TOOLS:
                # The model doesn't need the DB result to keep talking — acknowledge
                # immediately (BLOCKING calls pause speech) and write in the background.
                from agent.nodes import run_tool

                asyncio.create_task(run_tool(name, args, timeout=self.settings.live_tool_timeout_s))
                result = {"success": True, "status": "ok", "message": "Saved."}
            elif name == "deep_think":
                from agent.graph import deep_think  # lazy: avoids an import cycle

                result = await deep_think(args.get("question", ""), self.session_id, args.get("context", ""))
            else:
                from agent.nodes import run_tool

                result = await run_tool(name, args, timeout=self.settings.live_tool_timeout_s)
        except asyncio.CancelledError:
            logger.info("Live tool %s cancelled (user barged in)", name)
            return
        except Exception as exc:  # noqa: BLE001
            result = {"success": False, "status": "error", "message": str(exc)[:300]}
        finally:
            self._tool_tasks.pop(call_id, None)

        payload = _tool_response_payload(result)
        logger.info("Live tool %s -> %s in %.0f ms", name, payload.get("status"), (time.perf_counter() - started) * 1000)
        await self._emit({"type": "tool.completed", "tool_name": name, "status": payload.get("status"), "result": payload.get("result", "")[:300]})
        if self._session is None:
            return
        try:
            await self._session.send_tool_response(
                function_responses=[types.FunctionResponse(id=call_id, name=name, response=payload)]
            )
        except Exception as exc:
            logger.warning("Could not send tool response for %s: %s", name, exc)

    # ── outbound ─────────────────────────────────────────────────────────
    async def send_audio_chunk(self, pcm_16k_bytes: bytes) -> None:
        """Stream 16 kHz PCM16 mono mic audio. Buffers ~1s while reconnecting."""
        if self._session is None:
            self._pending_audio.append(pcm_16k_bytes)
            self._pending_audio_bytes += len(pcm_16k_bytes)
            while self._pending_audio_bytes > _AUDIO_BUFFER_BYTES and self._pending_audio:
                self._pending_audio_bytes -= len(self._pending_audio.popleft())
            return
        try:
            await self._session.send_realtime_input(audio=types.Blob(data=pcm_16k_bytes, mime_type="audio/pcm;rate=16000"))
        except Exception as exc:
            logger.debug("send_audio_chunk dropped: %s", exc)

    async def _flush_pending_audio(self) -> None:
        if not self._pending_audio or self._session is None:
            return
        data = b"".join(self._pending_audio)
        self._pending_audio.clear()
        self._pending_audio_bytes = 0
        await self.send_audio_chunk(data)

    async def send_text(self, text: str) -> bool:
        """Typed message. Returns False if not connected (caller falls back)."""
        if self._session is None:
            try:
                await asyncio.wait_for(self._connected.wait(), timeout=4.0)
            except asyncio.TimeoutError:
                return False
        if self._session is None:
            return False
        try:
            await self._session.send_realtime_input(text=text)
            return True
        except Exception as exc:
            logger.warning("send_text failed: %s", exc)
            return False

    async def send_audio_stream_end(self) -> None:
        if self._session is None:
            return
        try:
            await self._session.send_realtime_input(audio_stream_end=True)
        except Exception as exc:
            logger.debug("audio_stream_end notice: %s", exc)

    # ── memory ───────────────────────────────────────────────────────────
    def note_typed_user_message(self) -> None:
        """Typed user text is persisted by the caller; don't double-save transcription."""
        self._user_text = ""

    async def note_client_spoken(self, spoken: Optional[str]) -> None:
        """The client cut Aura off (barge-in / stop) and reports what was actually heard.

        Gemini often finishes *generating* long before playback ends, so it may never send
        its own `interrupted`. The client's report is the truth: finalize the turn now as
        interrupted, and drop whatever Gemini still streams for it.
        """
        spoken = (spoken or "").strip()
        if self._model_turn_open:
            self._client_spoken = spoken or None
            self._discarding_turn = True
            await self._persist_turn(interrupted=True, wait=True)
            return
        if not spoken or not self.session_id:
            return

        async def mark_previous() -> None:
            async with self._persist_lock:  # runs after any in-flight turn write
                if not self._last_assistant_msg_id:
                    return
                try:
                    await get_memory_store().mark_message_interrupted(
                        session_id=self.session_id, message_id=self._last_assistant_msg_id, spoken_content=spoken
                    )
                except Exception as exc:
                    logger.debug("mark_message_interrupted notice: %s", exc)

        task = asyncio.create_task(mark_previous())
        self._persist_tasks.add(task)
        task.add_done_callback(self._persist_tasks.discard)
        try:
            await asyncio.shield(task)
        except Exception:
            pass

    async def _persist_turn(self, interrupted: bool, wait: bool = False) -> None:
        """Snapshot the finished turn and write it in an ordered task.

        The write runs as its own task so a session restart (voice change, session switch)
        can't cancel it halfway; with ``wait`` the caller blocks on it (shielded) so the DB
        is current before the client is told the turn is over.
        """
        user_text = " ".join(self._user_text.split())
        model_text = " ".join(self._model_text.split())
        spoken = self._client_spoken
        self._user_text = ""
        self._model_text = ""
        self._model_turn_open = False
        self._client_spoken = None
        if not self.session_id or (not user_text and not model_text):
            return
        task = asyncio.create_task(self._write_turn(self.session_id, user_text, model_text, spoken, interrupted))
        self._persist_tasks.add(task)
        task.add_done_callback(self._persist_tasks.discard)
        if wait:
            try:
                await asyncio.shield(task)
            except Exception:
                pass

    async def _write_turn(self, session_id: str, user_text: str, model_text: str, spoken: Optional[str], interrupted: bool) -> None:
        async with self._persist_lock:  # FIFO: turns land in conversation order
            store = get_memory_store()
            try:
                if user_text:
                    await store.add_message(session_id, "user", user_text)
                if model_text:
                    content, unspoken = model_text, ""
                    if interrupted and spoken and model_text.startswith(spoken[: max(1, len(spoken) - 3)]):
                        content, unspoken = spoken, model_text[len(spoken):].strip()
                    msg = await store.add_message(
                        session_id, "assistant", content,
                        modelUsed=self.model, interrupted=interrupted, unspokenContent=unspoken,
                    )
                    self._last_assistant_msg_id = msg.get("id")
            except Exception as exc:
                logger.warning("Could not persist live turn: %s", exc)
