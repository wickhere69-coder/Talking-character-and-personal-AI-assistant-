"""Configuration management using Pydantic Settings."""
from __future__ import annotations

import os
from functools import lru_cache
from typing import List, Optional

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # Server
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

    # Gemini
    gemini_api_key: Optional[str] = None
    gemini_model: str = "models/gemini-3.5-flash-lite"
    gemini_fallback_model: str = "models/gemini-3.5-flash-lite"

    # Grok / xAI
    grok_api_key: Optional[str] = None
    xai_api_key: Optional[str] = None
    grok_model: str = "grok-3-mini"

    # Database
    db_path: str = "data/sessions.db"

    # Legacy migration paths
    legacy_sessions_path: str = "../data/sessions.json"
    legacy_memory_path: str = "../data/memory.json"

    # Session memory config
    max_history_turns: int = 8
    max_long_term_memories: int = 50
    summarize_every_n_messages: int = 4

    @property
    def origins_list(self) -> List[str]:
        """Return CORS origins as a list."""
        return [o.strip() for o in self.allowed_origins.split(",") if o.strip()]

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


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
