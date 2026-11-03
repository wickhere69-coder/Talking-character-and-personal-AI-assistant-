"""LangGraph node implementations for the Aura Agent."""
from __future__ import annotations

import asyncio
import re
from typing import Any, Dict, List, Optional

from langchain_core.messages import AIMessage, BaseMessage, HumanMessage, SystemMessage, ToolMessage
from langchain_core.runnables import RunnableConfig

from agent.providers.provider_manager import ProviderManager
from agent.state import AgentState
from agent.tools import TOOL_REGISTRY, extract_location_from_query, select_relevant_tools
from utils.logger import get_logger

logger = get_logger(__name__)


async def route_tools_node(state: AgentState) -> Dict[str, Any]:
    """Inspects the latest user message and determines available tools."""
    messages = state.get("messages", [])
    user_msg = ""
    for m in reversed(messages):
        if isinstance(m, HumanMessage) or getattr(m, "role", None) == "user":
            user_msg = str(m.content)
            break

    cfg = state.get("config", {})
    provider_name = cfg.get("modelProvider", "auto")
    tools = select_relevant_tools(user_msg, provider_name=provider_name)
    logger.debug("route_tools_node matched %d tools for query: %s", len(tools), user_msg[:50])

    return {
        "config": {**cfg, "available_tools": [t["name"] for t in tools]},
    }


async def pre_fetch_node(state: AgentState) -> Dict[str, Any]:
    """Pre-fetch weather or web results before LLM call for ultra-fast spoken response.
    Mirrors AgentCore.ts weather/search pre-fetch optimization.
    """
    messages = state.get("messages", [])
    user_msg = ""
    for m in reversed(messages):
        if isinstance(m, HumanMessage) or getattr(m, "role", None) == "user":
            user_msg = str(m.content)
            break

    available_tools = state.get("config", {}).get("available_tools", [])
    tool_results: List[Dict[str, Any]] = list(state.get("tool_results", []))
    injected_messages: List[BaseMessage] = []

    # 1. Weather pre-fetch optimization
    if "predict_weather" in available_tools:
        location = extract_location_from_query(user_msg)
        if location:
            logger.debug("Pre-fetching weather for location: %s", location)
            weather_tool = TOOL_REGISTRY.get("predict_weather")
            if weather_tool:
                try:
                    res = await weather_tool["func"](location)
                    tool_results.append({
                        "name": "predict_weather",
                        "parameters": {"location": location},
                        "result": res,
                    })
                    msg = (
                        f"[Pre-fetched Live Weather Context]: For {location}: "
                        f"{res.get('message', '')}. Use this information directly in your spoken answer."
                    )
                    injected_messages.append(SystemMessage(content=msg))
                except Exception as exc:
                    logger.warning("Pre-fetch weather failed: %s", exc)

    # 2. Live Web Search pre-fetch optimization
    # Triggers for explicit search requests or live real-time queries (news, current events, who won, latest, scores)
    search_keywords = re.compile(
        r"\b(search|look up|google|find online|browse|news|latest|today|current|recent|"
        r"who is|who won|score|winner|what happened|stock|price|election|super bowl|championship)\b",
        re.IGNORECASE
    )
    is_search = bool(search_keywords.search(user_msg) or "search" in user_msg.lower() or "online" in user_msg.lower())
    if "web_search" in available_tools and is_search:
        logger.info("Auto-enabling Deep Think web search for query: %s", user_msg[:60])
        web_tool = TOOL_REGISTRY.get("web_search")
        if web_tool:
            try:
                res = await web_tool["func"](query=user_msg)
                if res.get("success") and res.get("message"):
                    tool_results.append({
                        "name": "web_search",
                        "parameters": {"query": user_msg},
                        "result": res,
                    })
                    msg = (
                        f"[Live Web Search Ground Truth]: Real-time search findings for '{user_msg}':\n"
                        f"{res.get('message', '')}\n"
                        f"Synthesize an articulate, accurate spoken response using these live facts."
                    )
                    injected_messages.append(SystemMessage(content=msg))
            except Exception as exc:
                logger.warning("Live web search prefetch notice: %s", exc)

    return {
        "tool_results": tool_results,
        "messages": injected_messages,
    }


def extract_text_content(content: Any) -> str:
    """Extract plain text string from str, list of blocks, or dict."""
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
    return str(content or "")


async def llm_node(state: AgentState, config: Optional[RunnableConfig] = None) -> Dict[str, Any]:
    """Calls the selected LLM with streaming and tool awareness."""
    cfg = state.get("config", {})
    provider_override = cfg.get("modelProvider")
    mgr = ProviderManager()
    llm = mgr.get_llm(provider_override=provider_override)

    messages = list(state.get("messages", []))
    accumulated_text = ""
    model_used = getattr(llm, "model_name", None) or getattr(llm, "model", "ai-model")

    # Check for stream callback in config
    callbacks = config.get("callbacks") if isinstance(config, dict) else None
    handlers = getattr(callbacks, "handlers", callbacks) if callbacks else []
    stream_handler = None
    if isinstance(handlers, (list, tuple)):
        for cb in handlers:
            if hasattr(cb, "on_chunk"):
                stream_handler = cb
                break

    tool_iteration = state.get("tool_iteration", 0)

    try:
        # If the LLM supports streaming, stream chunks
        if hasattr(llm, "astream"):
            async for chunk in llm.astream(messages):
                raw_chunk = getattr(chunk, "content", chunk)
                content = extract_text_content(raw_chunk)
                if content:
                    accumulated_text += content
                    if stream_handler and hasattr(stream_handler, "on_chunk"):
                        await stream_handler.on_chunk(content)
        else:
            resp = await llm.ainvoke(messages)
            raw_resp = getattr(resp, "content", resp)
            accumulated_text = extract_text_content(raw_resp)
            if stream_handler and hasattr(stream_handler, "on_chunk"):
                await stream_handler.on_chunk(accumulated_text)

        ai_msg = AIMessage(content=accumulated_text)
        return {
            "messages": [ai_msg],
            "accumulated_text": accumulated_text,
            "is_done": True,
            "model_used": str(model_used),
            "tool_iteration": tool_iteration + 1,
            "error": None,
        }
    except Exception as exc:
        logger.error("llm_node failed: %s", exc, exc_info=True)
        fallback_msg = f"I apologize, but I encountered an issue processing that: {str(exc)}"
        if stream_handler and hasattr(stream_handler, "on_chunk"):
            await stream_handler.on_chunk(fallback_msg)
        return {
            "messages": [AIMessage(content=fallback_msg)],
            "accumulated_text": fallback_msg,
            "is_done": True,
            "model_used": "error_handler",
            "error": str(exc),
        }


async def execute_tools_node(state: AgentState, config: Optional[RunnableConfig] = None) -> Dict[str, Any]:
    """Executes any pending tool calls produced by the LLM."""
    messages = state.get("messages", [])
    last_msg = messages[-1] if messages else None
    tool_results: List[Dict[str, Any]] = list(state.get("tool_results", []))
    new_messages: List[BaseMessage] = []

    if not last_msg or not hasattr(last_msg, "tool_calls") or not last_msg.tool_calls:
        return {"tool_results": tool_results}

    callbacks = config.get("callbacks") if isinstance(config, dict) else None
    handlers = getattr(callbacks, "handlers", callbacks) if callbacks else []
    tool_start_cb = None
    tool_end_cb = None
    if isinstance(handlers, (list, tuple)):
        for cb in handlers:
            if hasattr(cb, "on_tool_start"):
                tool_start_cb = cb.on_tool_start
            if hasattr(cb, "on_tool_end"):
                tool_end_cb = cb.on_tool_end

    for tc in last_msg.tool_calls:
        name = tc.get("name")
        args = tc.get("args", {})
        tc_id = tc.get("id", f"call_{name}")

        if tool_start_cb:
            await tool_start_cb(name, args)

        tool_def = TOOL_REGISTRY.get(name)
        if not tool_def:
            res_dict = {"success": False, "error": f"Tool '{name}' not found."}
        else:
            try:
                res_dict = await tool_def["func"](**args)
            except Exception as e:
                res_dict = {"success": False, "error": str(e)}

        if tool_end_cb:
            await tool_end_cb(name, res_dict)

        tool_results.append({"name": name, "parameters": args, "result": res_dict})
        content_str = res_dict.get("message") or str(res_dict.get("data") or res_dict)
        new_messages.append(ToolMessage(content=content_str, tool_call_id=tc_id))

    return {
        "tool_results": tool_results,
        "messages": new_messages,
    }


def should_continue(state: AgentState) -> str:
    """Decides if the graph should execute tools or terminate."""
    messages = state.get("messages", [])
    if not messages:
        return "end"

    last_msg = messages[-1]
    has_tool_calls = bool(hasattr(last_msg, "tool_calls") and last_msg.tool_calls)
    iteration = state.get("tool_iteration", 0)

    if has_tool_calls and iteration < 3:
        return "execute_tools"
    return "end"

