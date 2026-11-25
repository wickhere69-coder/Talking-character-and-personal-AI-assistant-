"""Configuration management using Pydantic Settings."""
from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import Any, List, Optional

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

_BACKEND_DIR = Path(__file__).resolve().parent

# `npm run dev` starts uvicorn from the repo root while start-python-backend.bat starts
# it inside python_backend/, so a bare ".env" meant different files depending on how the
# app was launched. Read both; python_backend/.env wins on conflicts.
_ENV_FILES = (str(_BACKEND_DIR.parent / ".env"), str(_BACKEND_DIR / ".env"))


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=_ENV_FILES,
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # Server
    host: str = "127.0.0.1"
    port: int = 8000
    debug: bool = False
    log_level: str = "info"

    @field_validator("port", mode="before")
    @classmethod
    def validate_port(cls, v: Any) -> int:
        # If port 3001 leaked from root .env for Node.js server, use 8000 for Python
        if str(v) == "3001" or not v:
            return 8000
        return int(v)

    # CORS
    allowed_origins: str = "http://localhost:5173,http://localhost:3000,http://127.0.0.1:5173"

    # AI Provider
    model_provider: str = "auto"

    # ── Gemini Live (real-time voice brain) ──────────────────────────────
    # "native_gemini_live": Gemini's own expressive voice streams straight to the
    #   avatar (lowest latency, real emotional prosody, true barge-in).
    # "custom_voice_pack": Gemini Live thinks, ElevenLabs voice speaks the transcript.
    voice_mode: str = "native_gemini_live"
    # gemini-3.8-live supports BLOCKING tools + interleaved reasoning (recommended).
    # gemini-3.8-live-extended-thinking only supports NON_BLOCKING tools.
    gemini_live_model: str = "gemini-3.8-live"
    gemini_live_thinking_level: str = "low"  # only applied to *-extended-thinking
    gemini_live_voice: str = "Aoede"
    # Server-side voice activity detection — tuned for snappy, human turn-taking.
    live_vad_start_sensitivity: str = "high"   # high = barge-in triggers quickly
    live_vad_end_sensitivity: str = "high"     # high = turn ends promptly after the user stops
    live_vad_prefix_padding_ms: int = 100      # speech needed before start-of-speech commits
    live_vad_silence_ms: int = 600             # silence that ends the user's turn
    live_tool_timeout_s: float = 12.0
    live_history_turns: int = 12               # recent turns seeded into a fresh live session

    # ── Gemini text models (LangGraph path + deep_think tool) ────────────
    gemini_api_key: Optional[str] = None
    gemini_model: str = "gemini-3.8-flash"
    # Comma-separated failover chain tried in order when the primary is overloaded.
    gemini_fallback_models: str = "gemini-3.7-flash,gemini-3-flash-preview,gemini-3.5-flash-lite"
    # Legacy single-fallback setting (still honoured, appended to the chain).
    gemini_fallback_model: Optional[str] = None
    gemini_thinking_level: str = "low"          # conversational turns
    gemini_deep_thinking_level: str = "high"    # deep_think tool / complex questions
    llm_first_token_timeout_s: float = 6.0      # fail over if no token by then
    llm_model_cooldown_s: float = 90.0          # skip an overloaded model for this long

    # Grok / xAI
    grok_api_key: Optional[str] = None
    xai_api_key: Optional[str] = None
    grok_model: str = "grok-3-mini"

    # Database
    db_path: str = "data/sessions.db"

    # Legacy migration paths
    legacy_sessions_path: str = "../data/sessions.json"
    legacy_memory_path: str = "../data/memory.json"

    # Authentication & Google OAuth
    google_client_id: Optional[str] = None
    vite_google_client_id: Optional[str] = None

    # Session memory config
    max_history_turns: int = 8
    max_long_term_memories: int = 50
    summarize_every_n_messages: int = 4

    @property
    def origins_list(self) -> List[str]:
        """Return CORS origins as a list."""
        return [o.strip() for o in self.allowed_origins.split(",") if o.strip()]

    @property
    def effective_google_client_id(self) -> Optional[str]:
        raw = (self.google_client_id or self.vite_google_client_id or "").strip()
        if raw and not raw.startswith("your_"):
            return raw
        return None

    @property
    def effective_grok_key(self) -> Optional[str]:
        """Return grok API key, falling back to xai_api_key."""
        return self.grok_api_key or self.xai_api_key

    @property
    def has_gemini(self) -> bool:
        return bool(self.gemini_api_key and self.gemini_api_key != "your_gemini_api_key_here")

    @property
    def has_grok(self) -> bool:
        key = self.effective_grok_key
        return bool(key and key != "your_grok_api_key_here" and key != "your_xai_api_key_here")

    @property
    def gemini_model_chain(self) -> List[str]:
        """Ordered, de-duplicated list of Gemini text models to try."""
        raw = [self.gemini_model] + self.gemini_fallback_models.split(",")
        if self.gemini_fallback_model:
            raw.append(self.gemini_fallback_model)
        chain: List[str] = []
        for name in raw:
            name = (name or "").strip()
            if name.startswith("models/"):
                name = name[len("models/"):]
            if name and name not in chain:
                chain.append(name)
        return chain


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
