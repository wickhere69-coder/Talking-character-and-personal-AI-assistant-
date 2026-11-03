"""Provider manager: returns LangChain chat models for Gemini and Grok with caching and resilient failover."""
from __future__ import annotations

import os
from typing import Any, Dict, Optional

from utils.logger import get_logger

logger = get_logger(__name__)

# Module-level model instance caches for zero-overhead turn initialization
_CACHED_MODELS: Dict[str, Any] = {}


class ResilientGeminiModel:
    """Wraps ChatGoogleGenerativeAI with automatic fallback between fast models."""

    def __init__(self, primary_llm: Any, fallback_llm: Any, model_name: str):
        self._primary = primary_llm
        self._fallback = fallback_llm
        self.model_name = model_name
        self.model = model_name

    async def astream(self, messages: Any, **kwargs: Any):
        try:
            async for chunk in self._primary.astream(messages, **kwargs):
                yield chunk
        except Exception as e:
            logger.warning("Primary Gemini model (%s) failed (%s), failing over...", self.model_name, e)
            if self._fallback:
                async for chunk in self._fallback.astream(messages, **kwargs):
                    yield chunk
            else:
                raise

    async def ainvoke(self, messages: Any, **kwargs: Any):
        try:
            return await self._primary.ainvoke(messages, **kwargs)
        except Exception as e:
            logger.warning("Primary Gemini model (%s) ainvoke failed (%s), failing over...", self.model_name, e)
            if self._fallback:
                return await self._fallback.ainvoke(messages, **kwargs)
            raise

    def invoke(self, messages: Any, **kwargs: Any):
        try:
            return self._primary.invoke(messages, **kwargs)
        except Exception as e:
            logger.warning("Primary Gemini model (%s) invoke failed (%s), failing over...", self.model_name, e)
            if self._fallback:
                return self._fallback.invoke(messages, **kwargs)
            raise


class ProviderManager:
    """Manages LLM provider selection and instantiation."""

    def __init__(self, provider_override: Optional[str] = None):
        from config import get_settings
        settings = get_settings()
        self._settings = settings
        self._default_provider = provider_override or settings.model_provider

    def get_llm(self, provider_override: Optional[str] = None):
        """Return a LangChain ChatModel for the selected provider.
        Priority: provider_override → self._default_provider → auto-detect
        """
        provider = (provider_override or self._default_provider or "auto").lower()

        if provider in ("gemini", "auto", "langgraph"):
            llm = self._try_gemini()
            if llm is not None:
                return llm
            if provider == "gemini":
                raise RuntimeError("Gemini provider requested but GEMINI_API_KEY is not configured.")
            # auto: fall through to grok
            llm = self._try_grok()
            if llm is not None:
                return llm
            raise RuntimeError("No AI provider is configured. Set GEMINI_API_KEY in .env")

        if provider in ("grok", "xai"):
            llm = self._try_grok()
            if llm is not None:
                return llm
            raise RuntimeError("Grok provider requested but GROK_API_KEY / XAI_API_KEY is not configured.")

        # Unknown provider – try auto
        logger.warning("Unknown provider '%s', falling back to auto", provider)
        return self.get_llm("auto")

    def _try_gemini(self):
        """Attempt to instantiate or retrieve a cached resilient Gemini chat model."""
        cache_key = f"gemini_{self._settings.gemini_api_key}"
        if cache_key in _CACHED_MODELS:
            return _CACHED_MODELS[cache_key]

        try:
            from langchain_google_genai import ChatGoogleGenerativeAI

            api_key = self._settings.gemini_api_key
            if not api_key or api_key == "your_gemini_api_key_here":
                return None

            primary_model = self._settings.gemini_model or "models/gemini-3-flash-preview"
            fallback_model = getattr(self._settings, "gemini_fallback_model", "models/gemini-3.5-flash-lite")

            primary_llm = ChatGoogleGenerativeAI(
                model=primary_model,
                google_api_key=api_key,
                temperature=0.7,
                streaming=True,
            )

            fallback_llm = None
            if fallback_model != primary_model:
                try:
                    fallback_llm = ChatGoogleGenerativeAI(
                        model=fallback_model,
                        google_api_key=api_key,
                        temperature=0.7,
                        streaming=True,
                    )
                except Exception as fb_err:
                    logger.debug("Could not initialize fallback model: %s", fb_err)

            resilient = ResilientGeminiModel(primary_llm, fallback_llm, primary_model)
            _CACHED_MODELS[cache_key] = resilient
            logger.info("Resilient Gemini provider initialized: %s (fallback: %s)", primary_model, fallback_model)
            return resilient
        except Exception as e:
            logger.warning("Could not initialise Gemini provider: %s", e)
            return None

    def _try_grok(self):
        """Attempt to instantiate a Grok/xAI chat model via OpenAI-compatible API."""
        cache_key = f"grok_{self._settings.effective_grok_key}"
        if cache_key in _CACHED_MODELS:
            return _CACHED_MODELS[cache_key]

        try:
            from langchain_openai import ChatOpenAI

            api_key = self._settings.effective_grok_key
            if not api_key or api_key in ("your_grok_api_key_here", "your_xai_api_key_here"):
                return None

            model_name = self._settings.grok_model
            llm = ChatOpenAI(
                model=model_name,
                api_key=api_key,
                base_url="https://api.x.ai/v1",
                temperature=0.7,
                streaming=True,
            )
            _CACHED_MODELS[cache_key] = llm
            logger.debug("Grok provider initialised: %s", model_name)
            return llm
        except Exception as e:
            logger.warning("Could not initialise Grok provider: %s", e)
            return None

    def health_check(self) -> dict:
        """Return health status of each provider."""
        return {
            "gemini": self._settings.has_gemini,
            "grok": self._settings.has_grok,
            "default_provider": self._default_provider,
        }

    def key_status(self) -> dict:
        """Return which API keys are configured."""
        return {
            "gemini": self._settings.has_gemini,
            "grok": self._settings.has_grok,
            "elevenlabs": bool(os.environ.get("ELEVENLABS_API_KEY")),
        }
