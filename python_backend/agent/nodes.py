"""LangGraph node implementations for the Aura Agent.

Flow:  route_tools → pre_fetch → llm ⇄ execute_tools → END
  * route_tools  picks a small relevant tool set for this turn (fewer tools = faster, better choices)
  * pre_fetch    runs obvious lookups (weather / web) in parallel *before* the LLM so the answer
                 can stream on the first model call instead of after a tool round-trip
  * llm          streams from the strongest healthy model (see ModelRouter) with tools bound
  * execute_tools runs requested tools concurrently with timeouts, then loops back to llm
"""
from __future__ import annotations

import asyncio
import json
import re
from typing import Any, Dict, List, Optional

from langchain_core.messages import AIMessage, BaseMessage, HumanMessage, SystemMessage, ToolMessage
from langchain_core.messages.utils import message_chunk_to_message
from langchain_core.runnables import RunnableConfig

from agent.providers.provider_manager import AllModelsFailedError, ProviderManager
from agent.state import AgentState
from agent.tools import TOOL_REGISTRY, extract_location_from_query, select_relevant_tools
from config import get_settings
from utils.logger import get_logger

logger = get_logger(__name__)

MAX_TOOL_ITERATIONS = 3
TOOL_TIMEOUT_S = 12.0
OVERLOADED_REPLY = "Sorry — my brain's a bit overloaded for a second there. Mind asking me that again?"

_SEARCH_PATTERN = re.compile(
    r"(?:\b(?:search(?:\s+about|\s+for|\s+the\s+web|\s+online|\s+google)?|look\s*up|google|browse|find\s*(?:out|online))\b|"
    r"\b(?:latest|breaking|today's|current|recent)\s+(?:news|events|updates|headlines|status)\b|"
    r"\b(?:stock|crypto|share)\s+price\b|"
    r"\b(?:who\s+won|match\s+score|game\s+score|election\s+results|championship\s+winner|super\s+bowl)\b|"
    r"\b(?:what\s+happened\s+to|what\s+is\s+the\s+latest\s+on)\b)",
    re.IGNORECASE,
)
_SEARCH_PREFIX = re.compile(
    r"^(?:please\s+|can\s+you\s+|could\s+you\s+)?(?:search(?:\s+for|\s+about|\s+the\s+web\s+for|\s+online\s+for)?|"
    r"look\s*up|google|browse|find\s*(?:out\s+about|online\s+about|out)?)\s*",
    re.IGNORECASE,
)


# ── helpers ──────────────────────────────────────────────────────────────

def _sink(config: Optional[RunnableConfig]) -> Any:
    if not config:
        return None
    return (config.get("configurable") or {}).get("sink")


async def _emit(sink: Any, method: str, *args: Any) -> None:
    fn = getattr(sink, method, None) if sink else None
    if not fn:
        return
    try:
        res = fn(*args)
        if asyncio.iscoroutine(res):
            await res
    except Exception as exc:  # a broken client socket must not kill the turn
        logger.debug("sink.%s failed: %s", method, exc)


def _latest_user_text(messages: List[BaseMessage]) -> str:
    for m in reversed(messages):
        if isinstance(m, HumanMessage):
            return extract_text_content(m.content)
    return ""


def extract_text_content(content: Any) -> str:
    """Extract plain text from str, a list of content blocks, or a dict block."""
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts = []
        for item in content:
            if isinstance(item, str):
                parts.append(item)
            elif isinstance(item, dict) and item.get("type") == "text":
                parts.append(item.get("text", ""))
        return "".join(parts)
    if isinstance(content, dict) and content.get("type") == "text":
        return content.get("text", "")
    return ""


def _as_bindable(tool_def: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "type": "function",
        "function": {
            "name": tool_def["name"],
            "description": tool_def.get("description", ""),
            "parameters": tool_def.get("parameters") or {"type": "object", "properties": {}},
        },
    }


def _compose_messages(state: AgentState) -> List[BaseMessage]:
    """Fold pre-fetched context into the leading system prompt."""
    messages = list(state.get("messages", []))
    blocks = [b for b in state.get("context_blocks", []) if b]
    if not blocks:
        return messages
    extra = "\n\n".join(blocks)
    if messages and isinstance(messages[0], SystemMessage):
        base = extract_text_content(messages[0].content)
        return [SystemMessage(content=f"{base}\n\n{extra}")] + messages[1:]
    return [SystemMessage(content=extra)] + messages


def _tool_payload(result: Any) -> Dict[str, Any]:
    """Structured tool result: status + message (models loop on bare/empty results)."""
    if not isinstance(result, dict):
        return {"status": "ok", "message": str(result)[:4000]}
    ok = result.get("success", True)
    status = result.get("status") or ("ok" if ok else "error")
    msg = result.get("message") or result.get("error") or result.get("data") or ""
    if not isinstance(msg, str):
        msg = json.dumps(msg, default=str)
    return {"status": status, "message": msg[:4000], "retryable": False}


async def run_tool(name: str, args: Dict[str, Any], timeout: float = TOOL_TIMEOUT_S) -> Dict[str, Any]:
    tool_def = TOOL_REGISTRY.get(name)
    if not tool_def:
        return {"success": False, "status": "invalid_argument", "message": f"Tool '{name}' does not exist."}
    try:
        return await asyncio.wait_for(tool_def["func"](**(args or {})), timeout=timeout)
    except asyncio.TimeoutError:
        return {"success": False, "status": "timeout", "message": f"{name} took too long and was cancelled."}
    except TypeError as exc:
        return {"success": False, "status": "invalid_argument", "message": f"Bad arguments for {name}: {exc}"}
    except Exception as exc:  # noqa: BLE001
        logger.warning("Tool %s failed: %s", name, exc)
        return {"success": False, "status": "error", "message": str(exc)[:300]}


# ── nodes ────────────────────────────────────────────────────────────────

async def route_tools_node(state: AgentState) -> Dict[str, Any]:
    """Pick the tools relevant to this turn."""
    cfg = state.get("config", {})
    user_msg = _latest_user_text(list(state.get("messages", [])))
    tools = select_relevant_tools(user_msg, provider_name=cfg.get("modelProvider", "auto"))
    logger.debug("route_tools: %d tools for %r", len(tools), user_msg[:50])
    return {"config": {**cfg, "available_tools": [t["name"] for t in tools]}}


async def pre_fetch_node(state: AgentState) -> Dict[str, Any]:
    """Run obvious lookups concurrently before the LLM so it can answer in one pass."""
    cfg = state.get("config", {})
    available = cfg.get("available_tools", [])
    tool_results: List[Dict[str, Any]] = list(state.get("tool_results", []))
    blocks: List[str] = list(state.get("context_blocks", []))
    if not available:
        return {"tool_results": tool_results, "context_blocks": blocks}

    user_msg = _latest_user_text(list(state.get("messages", [])))
    tasks = []

    if "predict_weather" in available:
        location = extract_location_from_query(user_msg)
        if location:
            async def fetch_weather(loc: str = location):
                return ("weather", loc, await run_tool("predict_weather", {"location": loc}))
            tasks.append(fetch_weather())

    if "web_search" in available and (_SEARCH_PATTERN.search(user_msg) or cfg.get("deepThink")):
        query = _SEARCH_PREFIX.sub("", user_msg).strip().rstrip("?.!")
        query = query if len(query) > 1 else user_msg

        async def fetch_web(q: str = query):
            return ("web", q, await run_tool("web_search", {"query": q}))
        tasks.append(fetch_web())

    for kind, param, res in await asyncio.gather(*tasks):
        if not isinstance(res, dict) or res.get("success") is False or not res.get("message"):
            continue
        if kind == "weather":
            tool_results.append({"name": "predict_weather", "parameters": {"location": param}, "result": res})
            blocks.append(f"[Live weather, fetched just now for {param}]\n{res['message']}\nUse it directly in your answer.")
        else:
            tool_results.append({"name": "web_search", "parameters": {"query": param}, "result": res})
            blocks.append(
                f"[Live web results, fetched just now for '{param}']\n{str(res['message'])[:4000]}\n"
                "Answer from these facts; say so if they don't cover the question."
            )

    return {"tool_results": tool_results, "context_blocks": blocks}


async def llm_node(state: AgentState, config: Optional[RunnableConfig] = None) -> Dict[str, Any]:
    """Stream from the strongest healthy model, with this turn's tools bound."""
    settings = get_settings()
    cfg = state.get("config", {})
    sink = _sink(config)
    iteration = state.get("tool_iteration", 0)

    tool_defs = [TOOL_REGISTRY[n] for n in cfg.get("available_tools", []) if n in TOOL_REGISTRY]
    # On the last allowed iteration, withhold tools so the model must answer.
    tools = [_as_bindable(t) for t in tool_defs] if iteration < MAX_TOOL_ITERATIONS else []

    thinking = state.get("thinking_level") or settings.gemini_thinking_level
    mgr = ProviderManager()
    messages = _compose_messages(state)

    full = None
    model_used = state.get("model_used") or "auto"
    text = ""
    try:
        async for chunk, model in mgr.astream(
            messages,
            tools=tools or None,
            thinking_level=thinking,
            provider_override=cfg.get("modelProvider"),
        ):
            model_used = model
            full = chunk if full is None else full + chunk
            piece = extract_text_content(getattr(chunk, "content", ""))
            if piece:
                text += piece
                await _emit(sink, "on_chunk", piece)
    except AllModelsFailedError as exc:
        logger.error("llm_node: %s", exc)
        await _emit(sink, "on_chunk", OVERLOADED_REPLY)
        return {
            "messages": [AIMessage(content=OVERLOADED_REPLY)],
            "accumulated_text": state.get("accumulated_text", "") + OVERLOADED_REPLY,
            "is_done": True,
            "model_used": "unavailable",
            "tool_iteration": iteration + 1,
            "error": str(exc),
        }
    except Exception as exc:  # mid-stream failure: keep what we have
        logger.error("llm_node stream failed: %s", exc, exc_info=True)
        if not text:
            await _emit(sink, "on_chunk", OVERLOADED_REPLY)
            text = OVERLOADED_REPLY
        return {
            "messages": [AIMessage(content=text)],
            "accumulated_text": state.get("accumulated_text", "") + text,
            "is_done": True,
            "model_used": str(model_used),
            "tool_iteration": iteration + 1,
            "error": str(exc),
        }

    # Keep the aggregated chunk (not a fresh AIMessage) so Gemini 3 thought
    # signatures on function calls survive into the next model call.
    ai_msg = message_chunk_to_message(full) if full is not None else AIMessage(content="")
    has_tool_calls = bool(getattr(ai_msg, "tool_calls", None))
    accumulated = state.get("accumulated_text", "")
    if text:
        accumulated = f"{accumulated} {text}".strip() if accumulated else text

    return {
        "messages": [ai_msg],
        "accumulated_text": accumulated,
        "is_done": not has_tool_calls,
        "model_used": str(model_used),
        "tool_iteration": iteration + 1,
        "error": None,
    }


async def execute_tools_node(state: AgentState, config: Optional[RunnableConfig] = None) -> Dict[str, Any]:
    """Run the tool calls from the last AI message concurrently."""
    messages = state.get("messages", [])
    last = messages[-1] if messages else None
    tool_results: List[Dict[str, Any]] = list(state.get("tool_results", []))
    calls = list(getattr(last, "tool_calls", None) or [])
    if not calls:
        return {"tool_results": tool_results}

    sink = _sink(config)

    async def one(tc: Dict[str, Any]):
        name = tc.get("name", "")
        args = tc.get("args", {}) or {}
        await _emit(sink, "on_tool_start", name, args)
        res = await run_tool(name, args)
        await _emit(sink, "on_tool_end", name, res)
        payload = _tool_payload(res)
        msg = ToolMessage(content=json.dumps(payload), tool_call_id=tc.get("id") or f"call_{name}", name=name)
        return {"name": name, "parameters": args, "result": res}, msg

    done = await asyncio.gather(*(one(tc) for tc in calls))
    new_messages: List[BaseMessage] = []
    for record, msg in done:
        tool_results.append(record)
        new_messages.append(msg)
    return {"tool_results": tool_results, "messages": new_messages}


def should_continue(state: AgentState) -> str:
    messages = state.get("messages", [])
    if not messages:
        return "end"
    last = messages[-1]
    if getattr(last, "tool_calls", None) and state.get("tool_iteration", 0) <= MAX_TOOL_ITERATIONS:
        return "execute_tools"
    return "end"
