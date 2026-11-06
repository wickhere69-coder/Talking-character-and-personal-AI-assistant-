"""ContextBuilder — replicates TypeScript ContextManager faithfully.
Builds the optimal system prompt and message list for every conversation turn,
integrating session memory, topic context, rolling summaries, and retrieved historical exchanges.
"""
from __future__ import annotations

import asyncio
from datetime import datetime
from typing import Any, Dict, List, Optional

from langchain_core.messages import AIMessage, BaseMessage, HumanMessage, SystemMessage

from config import get_settings
from agent.persona import AURA_TEXT_PERSONA
from memory.store import MemoryStore, get_memory_store
from utils.logger import get_logger

logger = get_logger(__name__)


async def build_prompt_messages(
    user_message: str,
    session_id: Optional[str] = None,
    config: Optional[Dict[str, Any]] = None,
    memory_store: Optional[MemoryStore] = None,
) -> List[BaseMessage]:
    """Build the complete list of BaseMessages for the LLM turn."""
    settings = get_settings()
    store = memory_store or get_memory_store()
    cfg = config or {}
    max_history_turns = settings.max_history_turns

    # 1. Parallel DB retrieval with asyncio.gather (< 15ms total)
    async def get_sess():
        if session_id:
            return await store.get_session(session_id)
        return None

    pref_task = asyncio.create_task(store.get_preferences())
    recall_task = asyncio.create_task(store.recall(user_message))
    sess_task = asyncio.create_task(get_sess())

    preferences, recalled, session_data = await asyncio.gather(
        pref_task, recall_task, sess_task
    )

    pref_summary = "\n".join(f"• {k}: {v}" for k, v in preferences.items())
    recall_summary = "\n".join(f"• {m['key']}: {m['value']}" for m in recalled[:5])

    # 2. Temporal context
    now = datetime.now()
    date_str = now.strftime("%A, %B %d, %Y")
    time_str = now.strftime("%I:%M %p")
    current_year = now.year
    temporal_context = f"Today's Date: {date_str}. Current Time: {time_str}. Current Year: {current_year}."

    mode = cfg.get("mode", "conversational")
    is_conversational = mode in ("conversational", "chat")

    # 3. Session Context Assembly
    session_context_block = ""
    retrieved_context_block = ""
    last_exchange_block = ""
    interrupted_block = ""
    history_msgs: List[Dict[str, Any]] = []

    if session_data:
        target_session = session_data["session"]
        all_msgs = session_data["messages"]

        title_line = f'Active Session: "{target_session["title"]}"'
        topic_line = f'Session Topic: "{target_session["topic"]}"'

        summary_lines: List[str] = []
        if target_session.get("summary", "").strip():
            summary_lines.append(f"Established Summary:\n{target_session['summary'].strip()}")
        if target_session.get("establishedFacts"):
            facts_str = "\n".join(f"  • {f}" for f in target_session["establishedFacts"])
            summary_lines.append(f"Key Decisions & Requirements Established in This Session:\n{facts_str}")

        summary_part = ("\n" + "\n".join(summary_lines)) if summary_lines else ""
        session_context_block = f"\n\n[Active Session Context]\n{title_line}\n{topic_line}{summary_part}"

        # Filter messages to completed history turns
        history_msgs = [m for m in all_msgs if not m.get("pending") and m.get("content") != user_message]

        if history_msgs:
            last_assistant = next((m for m in reversed(history_msgs) if m["role"] == "assistant"), None)
            last_user = next((m for m in reversed(history_msgs) if m["role"] == "user"), None)

            if last_user or last_assistant:
                u_text = last_user["content"] if last_user else "(none)"
                a_text = last_assistant["content"] if last_assistant else "(none)"
                last_exchange_block = f'\n\n[Last Exchange in This Conversation]\nUser previously asked: "{u_text}"\nAura previously answered: "{a_text}"'

            if last_assistant and last_assistant.get("interrupted"):
                spoken = last_assistant.get("content", "")
                unspoken = last_assistant.get("unspokenContent", "")
                unsaid_hint = f' Unsaid remainder was: "{unspoken}".' if unspoken else ""
                interrupted_block = (
                    f'\n\n[Interrupted Speech Resumption State]\n'
                    f'Your previous utterance was interrupted by the user mid-sentence while speaking: "{spoken}".{unsaid_hint}\n'
                    f'Instruction: If the user says "continue", "go on", "what were you saying?", or asks to finish, '
                    f'smoothly resume from where you stopped without repeating what was already spoken and without apologizing.'
                )

        # Relevant historical exchanges
        retrieved_older = await store.retrieve_relevant_messages(
            session_id, user_message, limit=4, exclude_recent=max_history_turns
        )
        if retrieved_older:
            formatted_retrieved = "\n".join(
                f'[{("User earlier" if m["role"] == "user" else "Aura earlier")}]: "{m["content"]}"'
                for m in retrieved_older
            )
            retrieved_context_block = f'\n\n[Relevant Earlier Exchanges in This Session]\n{formatted_retrieved}\nInstruction: Refer back to these previous points if the user asks "what did we discuss earlier" or "continue where we stopped". Never invent false statements.'

    continuity_directive = """\n\n[Conversation Continuity & Follow-Up Rules]
1. References & Pronouns: Pronouns and follow-ups ("that", "the second one", "tell me more", "and then?", "continue", "what did I just ask?", "what were we talking about?") refer directly to the last exchange and session context above. Do not treat a follow-up as a new, unrelated question.
2. Recall: If the user asks "what did I just ask?" or "what was my last question?", state the user's previous question accurately and concisely.
3. Resumption: If the user says "continue", "go on", or resumes after an interruption or pause, pick up smoothly from the unsaid thought without restarting from scratch.
4. Fresh Sessions: In a fresh session without prior exchanges, do not invent or reference topics from other sessions."""

    long_term_blocks = []
    if pref_summary:
        long_term_blocks.append(f"[Known User Preferences (Long-term profile)]\n{pref_summary}")
    if recall_summary:
        long_term_blocks.append(f"[Relevant Long-Term Memories (Cross-session knowledge)]\n{recall_summary}")
    long_term_memory_block = ("\n\n" + "\n\n".join(long_term_blocks)) if long_term_blocks else ""

    # Shared Aura persona (same voice as the real-time Gemini Live brain)
    depth_hint = (
        "" if is_conversational else
        "\n\nWhen the user asks for depth (explanations, plans, analysis), you may go longer — "
        "but keep it spoken, structured with natural transitions, never lists."
    )
    system_prompt = (
        f"{AURA_TEXT_PERSONA}{depth_hint}\n\n[Now]\n{temporal_context}"
        f"{session_context_block}{last_exchange_block}{interrupted_block}{retrieved_context_block}"
        f"{continuity_directive}{long_term_memory_block}"
    ).strip()

    messages: List[BaseMessage] = [SystemMessage(content=system_prompt)]

    # Recent turns sliding window
    recent = history_msgs[-max_history_turns:]
    for m in recent:
        if m["role"] == "user":
            messages.append(HumanMessage(content=m["content"]))
        elif m["role"] == "assistant":
            messages.append(AIMessage(content=m["content"]))

    # Current user query
    messages.append(HumanMessage(content=user_message))

    return messages

