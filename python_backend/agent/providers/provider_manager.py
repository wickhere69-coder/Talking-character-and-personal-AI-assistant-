"""Model routing for the LangGraph text brain.

Gemini's text endpoints regularly return 503 "high demand" for the newest models.
LangChain's default of six silent retries turned that into 60+ second stalls, so the
router instead:
  * tries an ordered chain (strongest first: gemini-3.8-flash → 3.7-flash → 3.5-flash-lite → Grok),
  * gives each model a first-token deadline and fails over the moment it's missed,
  * opens a circuit breaker on an overloaded model so later turns skip it instantly.
"""
from __future__ import annotations

import asyncio
import os
import time
from dataclasses import dataclass
from typing import Any, AsyncIterator, Dict, List, Optional, Sequence, Tuple

from utils.logger import get_logger

logger = get_logger(__name__)

# Built chat models are cached by (provider, model, thinking level).
_CACHED_MODELS: Dict[Tuple[str, str, str], Any] = {}
# model name -> monotonic time until which it is skipped
_COOLDOWN_UNTIL: Dict[str, float] = {}
# models that rejected thinking_level (400) — rebuilt without it
_NO_THINKING: set = set()

_OVERLOAD_MARKERS = ("503", "429", "unavailable", "high demand", "overloaded", "resource_exhausted", "quota", "deadline", "timeout")


@dataclass(frozen=True)
class ModelCandidate:
    provider: str  # "gemini" | "grok"
    model: str


class AllModelsFailedError(RuntimeError):
    pass


_DEAD_MARKERS = ("incorrect api key", "api key not valid", "invalid api key", "401", "403", "permission", "404", "not found", "no longer available")


def _is_overload(exc: BaseException) -> bool:
    text = f"{type(exc).__name__} {exc}".lower()
    return isinstance(exc, asyncio.TimeoutError) or any(m in text for m in _OVERLOAD_MARKERS)


def _cooldown_for(exc: BaseException, base: float) -> float:
    """Auth/missing-model errors won't fix themselves soon; overloads usually clear in a minute or two."""
    text = f"{type(exc).__name__} {exc}".lower()
    if any(m in text for m in _DEAD_MARKERS):
        return 3600.0
    return base if _is_overload(exc) else base / 3


def _cooldown(model: str, seconds: float) -> None:
    _COOLDOWN_UNTIL[model] = time.monotonic() + seconds


def _is_cooling(model: str) -> bool:
    return _COOLDOWN_UNTIL.get(model, 0.0) > time.monotonic()


class ProviderManager:
    """Builds chat models and streams from the first healthy one."""

    def __init__(self, provider_override: Optional[str] = None):
        from config import get_settings

        self._settings = get_settings()
        self._default_provider = (provider_override or self._settings.model_provider or "auto").lower()

    # ── Candidate selection ──────────────────────────────────────────────
    def candidates(self, provider_override: Optional[str] = None) -> List[ModelCandidate]:
        provider = (provider_override or self._default_provider or "auto").lower()
        gemini = [ModelCandidate("gemini", m) for m in self._settings.gemini_model_chain] if self._settings.has_gemini else []
        grok = [ModelCandidate("grok", self._settings.grok_model)] if self._settings.has_grok else []

        if provider in ("grok", "xai"):
            ordered = grok + gemini
        else:  # gemini | auto | langgraph | unknown
            ordered = gemini + grok
        if not ordered:
            raise RuntimeError("No AI provider is configured. Set GEMINI_API_KEY (or GROK_API_KEY) in python_backend/.env")

        healthy = [c for c in ordered if not _is_cooling(c.model)]
        # If everything is cooling down, still try them all rather than fail outright.
        return healthy or ordered

    # ── Model construction ───────────────────────────────────────────────
    def build(self, cand: ModelCandidate, thinking_level: Optional[str] = None) -> Any:
        level = None if cand.model in _NO_THINKING else (thinking_level or None)
        key = (cand.provider, cand.model, level or "")
        if key in _CACHED_MODELS:
            return _CACHED_MODELS[key]

        if cand.provider == "gemini":
            from langchain_google_genai import ChatGoogleGenerativeAI

            kwargs: Dict[str, Any] = dict(
                model=cand.model,
                google_api_key=self._settings.gemini_api_key,
                temperature=0.8,
                streaming=True,
                max_retries=0,  # we fail over instead of silently retrying
                timeout=45,
            )
            if level:
                kwargs["thinking_level"] = level
            llm = ChatGoogleGenerativeAI(**kwargs)
        else:
            from langchain_openai import ChatOpenAI

            llm = ChatOpenAI(
                model=cand.model,
                api_key=self._settings.effective_grok_key,
                base_url="https://api.x.ai/v1",
                temperature=0.8,
                streaming=True,
                max_retries=0,
                timeout=45,
            )
        _CACHED_MODELS[key] = llm
        logger.debug("Built chat model %s/%s (thinking=%s)", cand.provider, cand.model, level)
        return llm

    def get_llm(self, provider_override: Optional[str] = None, thinking_level: Optional[str] = None) -> Any:
        """Back-compat: return the first healthy chat model (no failover)."""
        cand = self.candidates(provider_override)[0]
        return self.build(cand, thinking_level or self._settings.gemini_thinking_level)

    # ── Streaming with hedged failover ───────────────────────────────────
    async def _first_chunk(
        self,
        cand: ModelCandidate,
        messages: Sequence[Any],
        tools: Optional[List[Dict[str, Any]]],
        thinking_level: Optional[str],
        deadline: float,
    ) -> Tuple[Any, Any, float]:
        """Open a stream and wait for its first chunk. Returns (agen, first_chunk, started)."""
        for attempt in range(2):  # 2nd attempt only to retry without thinking_level
            llm = self.build(cand, thinking_level)
            runnable = llm.bind_tools(tools) if tools else llm
            agen = runnable.astream(list(messages)).__aiter__()
            started = time.perf_counter()
            try:
                first = await asyncio.wait_for(agen.__anext__(), timeout=deadline)
                return agen, first, started
            except asyncio.CancelledError:
                await _safe_aclose(agen)
                raise
            except Exception as exc:
                await _safe_aclose(agen)
                msg = str(exc).lower()
                if attempt == 0 and thinking_level and "thinking" in msg and "support" in msg:
                    logger.info("LLM %s rejected thinking_level=%s — retrying without it", cand.model, thinking_level)
                    _NO_THINKING.add(cand.model)
                    continue
                raise
        raise RuntimeError(f"{cand.model}: could not start stream")

    async def astream(
        self,
        messages: Sequence[Any],
        tools: Optional[List[Dict[str, Any]]] = None,
        thinking_level: Optional[str] = None,
        provider_override: Optional[str] = None,
        first_token_timeout: Optional[float] = None,
        hedge_after: Optional[float] = None,
    ) -> AsyncIterator[Tuple[Any, str]]:
        """Yield (chunk, model_name) from the first model to produce a token.

        Starts the strongest healthy model; if it errors, the next starts immediately, and if it
        is merely slow (no token after ``hedge_after`` s) a backup is raced alongside it. The
        first stream to emit wins; the loser is cancelled.
        """
        deadline = first_token_timeout or self._settings.llm_first_token_timeout_s
        hedge = hedge_after if hedge_after is not None else min(2.0, deadline / 2)
        cooldown = self._settings.llm_model_cooldown_s
        cands = self.candidates(provider_override)
        errors: List[str] = []
        pending: Dict[asyncio.Task, ModelCandidate] = {}
        next_idx = 0

        def launch() -> None:
            nonlocal next_idx
            cand = cands[next_idx]
            next_idx += 1
            task = asyncio.create_task(self._first_chunk(cand, messages, tools, thinking_level, deadline))
            pending[task] = cand

        launch()
        winner: Optional[Tuple[ModelCandidate, Any, Any, float]] = None
        try:
            while pending and winner is None:
                can_hedge = next_idx < len(cands) and len(pending) < 2
                done, _ = await asyncio.wait(
                    set(pending), timeout=hedge if can_hedge else None, return_when=asyncio.FIRST_COMPLETED
                )
                if not done:
                    logger.info("LLM %s slow to first token — hedging with %s", pending[next(iter(pending))].model, cands[next_idx].model)
                    launch()
                    continue
                for task in done:
                    cand = pending.pop(task)
                    exc = task.exception()
                    if exc is None:
                        if winner is None:
                            agen, first, started = task.result()
                            winner = (cand, agen, first, started)
                        else:  # a second racer finished at the same moment — discard it
                            await _safe_aclose(task.result()[0])
                        continue
                    secs = _cooldown_for(exc, cooldown)
                    _cooldown(cand.model, secs)
                    logger.warning("LLM %s failed before first token (%s) — cooling %.0fs", cand.model, str(exc)[:140], secs)
                    errors.append(f"{cand.model}: {str(exc)[:120] or type(exc).__name__}")
                    if winner is None and next_idx < len(cands) and len(pending) < 2:
                        launch()
        finally:
            for task in list(pending):
                task.cancel()
            for task in list(pending):
                try:
                    res = await task
                    await _safe_aclose(res[0])
                except BaseException:
                    pass

        if winner is None:
            raise AllModelsFailedError("All language models are unavailable right now: " + " | ".join(errors))

        cand, agen, first, started = winner
        logger.info("LLM %s first token in %.0f ms", cand.model, (time.perf_counter() - started) * 1000)
        yield first, cand.model
        async for chunk in agen:
            yield chunk, cand.model

    # ── Status ───────────────────────────────────────────────────────────
    def health_check(self) -> dict:
        now = time.monotonic()
        return {
            "gemini": self._settings.has_gemini,
            "grok": self._settings.has_grok,
            "default_provider": self._default_provider,
            "text_model_chain": self._settings.gemini_model_chain,
            "live_model": self._settings.gemini_live_model,
            "cooling_down": {m: round(t - now, 1) for m, t in _COOLDOWN_UNTIL.items() if t > now},
        }

    def key_status(self) -> dict:
        return {
            "gemini": self._settings.has_gemini,
            "grok": self._settings.has_grok,
            "elevenlabs": bool(os.environ.get("ELEVENLABS_API_KEY")),
        }


async def _safe_aclose(agen: Any) -> None:
    try:
        await agen.aclose()
    except Exception:
        pass
