"""FastAPI application entry point for the Python AI backend."""
from __future__ import annotations

from contextlib import asynccontextmanager
import uvicorn
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.base import BaseHTTPMiddleware

from api.routes import router as api_router
from api.websocket import router as ws_router
from auth.routes import router as auth_router
from config import get_settings
from memory.store import get_memory_store
from utils.logger import get_logger

logger = get_logger("aura_backend")


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()
    logger.info("Starting Python Aura AI Backend on port %d...", settings.port)
    # Initialize SQLite database and run legacy migration
    store = get_memory_store()
    await store.init_db()
    logger.info(
        "Database ready. Live voice: %s (%s, voice=%s) | text brain: %s",
        settings.gemini_live_model, settings.voice_mode, settings.gemini_live_voice,
        " → ".join(settings.gemini_model_chain),
    )
    yield
    from agent.tools.weather_tools import close_shared_session

    await close_shared_session()
    logger.info("Python Aura AI Backend shutting down.")


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    """Attach defensive security headers to all HTTP responses."""

    async def dispatch(self, request: Request, call_next):
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        response.headers["Permissions-Policy"] = "camera=(), geolocation=()"
        if request.url.path.startswith("/api/"):
            response.headers["Cache-Control"] = "no-store"
        return response


def create_app() -> FastAPI:
    settings = get_settings()

    app = FastAPI(
        title="Aura AI Agent Backend",
        description="FastAPI + LangGraph AI Backend for Talking Character / Aura Assistant",
        version="2.0.0",
        lifespan=lifespan,
    )

    # Security headers
    app.add_middleware(SecurityHeadersMiddleware)

    # Strict CORS configuration (disallow wildcard origins when credentials are enabled)
    safe_origins = [o for o in settings.origins_list if o != "*"]
    app.add_middleware(
        CORSMiddleware,
        allow_origins=safe_origins,
        allow_credentials=True,
        allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
        allow_headers=["Content-Type", "Authorization", "X-Admin-Secret", "X-Admin-Token"],
    )

    # Register API routers
    app.include_router(ws_router)
    app.include_router(auth_router)
    app.include_router(api_router)

    return app


app = create_app()

if __name__ == "__main__":
    settings = get_settings()
    uvicorn.run(
        "main:app",
        host=settings.host,
        port=settings.port,
        reload=settings.debug,
        log_level=settings.log_level,
    )

