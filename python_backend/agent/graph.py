"""LangGraph StateGraph definition for the Aura Agent."""
from __future__ import annotations

import asyncio
from typing import Any, Callable, Dict, Optional

from langchain_core.callbacks import AsyncCallbackHandler
from langgraph.graph import END, START, StateGraph

from agent.nodes import execute_tools_node, llm_node, pre_fetch_node, route_tools_node, should_continue
from agent.state import AgentState
from memory.context_builder import build_prompt_messages
from memory.store import get_memory_store
from utils.logger import get_logger

logger = get_logger(__name__)


def create_agent_graph() -> StateGraph:
    """Build and compile the LangGraph agent graph."""
    workflow = StateGraph(AgentState)

    # 1. Add nodes
    workflow.add_node("route_tools", route_tools_node)
    workflow.add_node("pre_fetch", pre_fetch_node)
    workflow.add_node("llm", llm_node)
    workflow.add_node("execute_tools", execute_tools_node)

    # 2. Add edges
    workflow.add_edge(START, "route_tools")
    workflow.add_edge("route_tools", "pre_fetch")
    workflow.add_edge("pre_fetch", "llm")

    # 3. Conditional tool-call loop (max 3 iterations)
    workflow.add_conditional_edges(
        "llm",
        should_continue,
        {
            "execute_tools": "execute_tools",
            "end": END,
        },
    )
    workflow.add_edge("execute_tools", "llm")

    return workflow


# Compile the graph
_compiled_graph = None


def get_agent_graph():
    global _compiled_graph
    if _compiled_graph is None:
        graph = create_agent_graph()
        _compiled_graph = graph.compile()
        logger.info("Compiled LangGraph Agent Graph.")
    return _compiled_graph


class StreamCallbackAdapter(AsyncCallbackHandler):
    """Adapts arbitrary async callables into LangGraph callbacks."""

    def __init__(
        self,
        on_chunk: Optional[Callable[[str], Any]] = None,
        on_tool_start: Optional[Callable[[str, dict], Any]] = None,
        on_tool_end: Optional[Callable[[str, dict], Any]] = None,
    ):
        super().__init__()
        self._on_chunk = on_chunk
        self._on_tool_start = on_tool_start
        self._on_tool_end = on_tool_end

    async def on_chunk(self, chunk: str) -> None:
        if self._on_chunk:
            res = self._on_chunk(chunk)
            if asyncio.iscoroutine(res):
                await res

    async def on_tool_start(self, name: str, args: dict) -> None:
        if self._on_tool_start:
            res = self._on_tool_start(name, args)
            if asyncio.iscoroutine(res):
                await res

    async def on_tool_end(self, name: str, result: dict) -> None:
        if self._on_tool_end:
            res = self._on_tool_end(name, result)
            if asyncio.iscoroutine(res):
                await res


async def run_agent_turn(
    user_message: str,
    session_id: str,
    request_id: str,
    config: Optional[Dict[str, Any]] = None,
    on_chunk: Optional[Callable[[str], Any]] = None,
    on_tool_start: Optional[Callable[[str, dict], Any]] = None,
    on_tool_end: Optional[Callable[[str, dict], Any]] = None,
) -> Dict[str, Any]:
    """High-level runner: prepares context, executes LangGraph, persists turn in SQLite."""
    store = get_memory_store()
    cfg = config or {}

    # 1. Build context-rich message list (mirrors ContextManager)
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
        "tool_results": [],
        "accumulated_text": "",
        "is_done": False,
        "error": None,
        "model_used": "auto",
        "tool_iteration": 0,
    }

    # Callback adapter
    adapter = StreamCallbackAdapter(
        on_chunk=on_chunk,
        on_tool_start=on_tool_start,
        on_tool_end=on_tool_end,
    )

    graph = get_agent_graph()

    # Execute graph
    final_state = await graph.ainvoke(
        initial_state,
        {"callbacks": [adapter]},
    )

    final_text = final_state.get("accumulated_text", "").strip()
    model_used = final_state.get("model_used", "auto")

    # 2. Persist turn in SQLite (both session-specific and global legacy)
    if session_id and final_text:
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

