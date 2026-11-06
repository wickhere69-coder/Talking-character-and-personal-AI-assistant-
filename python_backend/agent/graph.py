"""LangGraph StateGraph definition for the Aura Agent."""
from __future__ import annotations

import asyncio
from typing import Any, Callable, Dict, Optional

from langgraph.graph import END, START, StateGraph

from agent.nodes import execute_tools_node, llm_node, pre_fetch_node, route_tools_node, should_continue
from agent.persona import DEEP_THINK_DIRECTIVE
from agent.state import AgentState
from config import get_settings
from memory.context_builder import build_prompt_messages
from memory.store import get_memory_store
from utils.logger import get_logger

logger = get_logger(__name__)


def create_agent_graph() -> StateGraph:
    workflow = StateGraph(AgentState)
    workflow.add_node("route_tools", route_tools_node)
    workflow.add_node("pre_fetch", pre_fetch_node)
    workflow.add_node("llm", llm_node)
    workflow.add_node("execute_tools", execute_tools_node)

    workflow.add_edge(START, "route_tools")
    workflow.add_edge("route_tools", "pre_fetch")
    workflow.add_edge("pre_fetch", "llm")
    workflow.add_conditional_edges("llm", should_continue, {"execute_tools": "execute_tools", "end": END})
    workflow.add_edge("execute_tools", "llm")
    return workflow


_compiled_graph = None


def get_agent_graph():
    global _compiled_graph
    if _compiled_graph is None:
        _compiled_graph = create_agent_graph().compile()
        logger.info("Compiled LangGraph agent graph.")
    return _compiled_graph


class StreamSink:
    """Receives streamed text and tool lifecycle events from graph nodes."""

    def __init__(
        self,
        on_chunk: Optional[Callable[[str], Any]] = None,
        on_tool_start: Optional[Callable[[str, dict], Any]] = None,
        on_tool_end: Optional[Callable[[str, dict], Any]] = None,
    ):
        self._on_chunk = on_chunk
        self._on_tool_start = on_tool_start
        self._on_tool_end = on_tool_end

    @staticmethod
    async def _call(fn: Optional[Callable[..., Any]], *args: Any) -> None:
        if fn:
            res = fn(*args)
            if asyncio.iscoroutine(res):
                await res

    async def on_chunk(self, chunk: str) -> None:
        await self._call(self._on_chunk, chunk)

    async def on_tool_start(self, name: str, args: dict) -> None:
        await self._call(self._on_tool_start, name, args)

    async def on_tool_end(self, name: str, result: dict) -> None:
        await self._call(self._on_tool_end, name, result)


# Back-compat alias for older imports.
StreamCallbackAdapter = StreamSink


async def run_agent_turn(
    user_message: str,
    session_id: str,
    request_id: str,
    config: Optional[Dict[str, Any]] = None,
    on_chunk: Optional[Callable[[str], Any]] = None,
    on_tool_start: Optional[Callable[[str, dict], Any]] = None,
    on_tool_end: Optional[Callable[[str, dict], Any]] = None,
    persist_user: bool = True,
    persist: bool = True,
) -> Dict[str, Any]:
    """Prepare context, run the graph, and persist the turn."""
    store = get_memory_store()
    settings = get_settings()
    cfg = dict(config or {})
    deep = bool(cfg.get("deep"))

    initial_messages = await build_prompt_messages(
        user_message=user_message,
        session_id=session_id,
        config=cfg,
        memory_store=store,
    )

    initial_state: AgentState = {
        "messages": initial_messages,
        "session_id": session_id,
        "request_id": request_id,
        "config": cfg,
        "context_blocks": [DEEP_THINK_DIRECTIVE] if deep else [],
        "thinking_level": settings.gemini_deep_thinking_level if deep else (cfg.get("thinkingLevel") or settings.gemini_thinking_level),
        "tool_results": [],
        "accumulated_text": "",
        "is_done": False,
        "error": None,
        "model_used": "auto",
        "tool_iteration": 0,
    }

    sink = StreamSink(on_chunk=on_chunk, on_tool_start=on_tool_start, on_tool_end=on_tool_end)
    final_state = await get_agent_graph().ainvoke(initial_state, {"configurable": {"sink": sink}})

    final_text = (final_state.get("accumulated_text") or "").strip()
    model_used = final_state.get("model_used", "auto")

    if persist and session_id and final_text:
        if persist_user:
            await store.add_message(session_id, "user", user_message)
        await store.add_message(session_id, "assistant", final_text, modelUsed=model_used)

    return {
        "response": final_text,
        "model_used": model_used,
        "session_id": session_id,
        "request_id": request_id,
        "tool_results": final_state.get("tool_results", []),
        "error": final_state.get("error"),
    }


async def deep_think(question: str, session_id: Optional[str] = None, context: str = "") -> Dict[str, Any]:
    """Hand a hard problem to the strongest text model with high reasoning effort.

    Used as a tool by the real-time voice model: it keeps talking naturally while this
    runs, then paraphrases the answer.
    """
    q = (question or "").strip()
    if not q:
        return {"success": False, "status": "invalid_argument", "message": "No question given."}
    prompt = f"{q}\n\nContext from the conversation: {context.strip()}" if context and context.strip() else q
    settings = get_settings()
    try:
        result = await asyncio.wait_for(
            run_agent_turn(
                user_message=prompt,
                session_id=session_id or "",
                request_id="deep_think",
                config={"deep": True, "mode": "agent", "modelProvider": "auto"},
                persist=False,
            ),
            timeout=max(5.0, settings.live_tool_timeout_s * 2 - 2),
        )
    except asyncio.TimeoutError:
        return {
            "success": False,
            "status": "timeout",
            "message": "Deep reasoning timed out. Answer as best you can from your own knowledge and say you're not fully certain.",
        }
    answer = (result.get("response") or "").strip()
    if result.get("model_used") == "unavailable" or not answer:
        return {
            "success": False,
            "status": "unavailable",
            "message": "The reasoning engine is busy. Work it out yourself step by step, and be upfront if unsure.",
        }
    return {"success": True, "status": "ok", "message": answer, "model": result.get("model_used")}
