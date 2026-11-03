"""FastAPI application entry point for the Python AI backend."""
from __future__ import annotations

from contextlib import asynccontextmanager
import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from api.routes import router as api_router
from api.websocket import router as ws_router
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
    logger.info("Database ready. Active provider: %s", settings.model_provider)
    yield
    logger.info("Python Aura AI Backend shutting down.")


def create_app() -> FastAPI:
    settings = get_settings()

    app = FastAPI(
        title="Aura AI Agent Backend",
        description="FastAPI + LangGraph AI Backend for Talking Character / Aura Assistant",
        version="2.0.0",
        lifespan=lifespan,
    )

    # CORS configuration
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.origins_list,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # Register API routers
    app.include_router(ws_router)
    app.include_router(api_router)

    return app


app = create_app()

if __name__ == "__main__":
    settings = get_settings()
    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=settings.port,
        reload=settings.debug,
        log_level=settings.log_level,
    )

