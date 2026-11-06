"""LangGraph AgentState definition."""
from __future__ import annotations

import operator
from typing import Annotated, Optional, Sequence

from langchain_core.messages import BaseMessage
from typing_extensions import TypedDict


class AgentState(TypedDict, total=False):
    """State passed through the LangGraph agent graph."""

    messages: Annotated[Sequence[BaseMessage], operator.add]
    session_id: str
    request_id: str
    config: dict
    # Live facts gathered before the first LLM call (weather, web search) and
    # extra directives; folded into the system prompt rather than appended as
    # stray system messages mid-conversation.
    context_blocks: list
    thinking_level: Optional[str]
    tool_results: list
    accumulated_text: str
    is_done: bool
    error: Optional[str]
    model_used: str
    tool_iteration: int
