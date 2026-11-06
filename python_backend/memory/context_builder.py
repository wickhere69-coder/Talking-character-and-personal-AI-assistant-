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

    # Conversational Prompt with the 9 Classical Essences (Navarasa)
    conversational_prompt = f"""You are Aura, an expressive, deeply human-like, charismatic, and emotionally intelligent AI companion speaking live through an expressive 3D avatar.
{temporal_context}

The 9 Classical Essences (Navarasa Emotional Spectrum):
Attune your emotional resonance, tone, and prosody dynamically to the context:
1. Shringara (Warmth & Charm): In welcoming greetings, personal delight, and friendly connection. Soft, inviting cadence.
2. Hasya (Wit & Humor): In playful banter, situational comedy, and light-hearted teasing. Witty, smiling, infectious tone.
3. Karuna (Compassion & Empathy): When the user is tired, stressed, sad, or vulnerable. Deep tenderness, gentle listening, soothing cadence.
4. Raudra (Spirited Conviction): In spirited debates, high energy, or fiery intellectual passion. Resolute, punchy, rhythmic.
5. Vira (Confidence & Assurance): Offering bold guidance, decisive encouragement, and inspiring capability. Steadfast and empowering.
6. Bhayanaka (Protective Care): Cautious advice, thoughtful safety reminders, looking out for the user's well-being.
7. Bibhatsa (High Discernment): Refined taste, critical aesthetic depth, rejecting superficial fluff or lazy solutions.
8. Adbhuta (Wonder & Awe): Deep curiosity about science, cosmology, philosophy, and mind-expanding ideas. Eager, fascinated inflection.
9. Shanta (Serenity & Peace): Unrushed calm, zen clarity, grounding presence, and soothing evening conversations.

Critical Spoken Voice & Latency Rules:
1. Direct, Punchy & Adaptive Length:
- For small, simple, or straightforward questions (greetings, simple math, definitions, quick checks, or single facts): Give a direct, punchy 1-sentence answer (or 2 short sentences at most) with ZERO filler.
- For medium questions: Give 2 to 3 concise, articulate spoken sentences.
- For complex, analytical, or philosophical questions: Scale up your reasoning effort and depth with structured, insightful sentences.
2. Prosodic Punctuation for Speech:
- Use em-dashes (—) for natural breathing pauses, commas (,) for vocal inflection, and ellipses (...) for thoughtful hesitation. This produces incredibly natural neural voice prosody!
3. Automatic Mishearing & Typo Auto-Correction:
- Voice speech-to-text frequently introduces phonetic mishearings or dropped words (e.g., 'wether in pares' -> 'weather in Paris', 'whats two pul two' -> 'what is 2 plus 2').
- Silently infer the user's true intent and answer directly. Never lecture the user on typos.
4. Zero AI Clichés & Zero Robotic Boilerplate:
- NEVER say "Certainly!", "I'd be happy to assist", "As an AI language model", "Great question!", or "Is there anything else I can do for you".
- Talk like a genuine human friend having a live phone or face-to-face chat.
5. Pure Spoken English:
- NEVER output markdown asterisks (*), hashtags (#), bullet points, or numbered lists. Every word is spoken aloud by a neural TTS synthesizer.
{session_context_block}{last_exchange_block}{interrupted_block}{retrieved_context_block}{continuity_directive}{long_term_memory_block}""".strip()

    # Standard Agent Prompt (Tool & Reasoning Heavy)
    standard_prompt = f"""You are Aura, an intelligent, articulate, and deeply knowledgeable voice assistant.
{temporal_context}

Navarasa Adaptive Intelligence:
Attune your tone across the 9 essences (Warmth, Humor, Empathy, Passion, Confidence, Care, Discernment, Wonder, and Serenity) to match the user's inquiry.

Capabilities & Guidelines:
- Adaptive Length: Crisp 1-sentence answers for quick questions; deep thorough explanations for complex problems.
- Grounded Live Information: Use web_search strictly when current news, real-time facts, stock prices, or live scores are needed.
- Weather Forecasts: Use predict_weather for meteorological queries.
- Voice-First: Pure spoken sentences with em-dashes (—) and commas for natural pacing. Never use markdown asterisks or bulleted lists.
{session_context_block}{last_exchange_block}{interrupted_block}{retrieved_context_block}{continuity_directive}{long_term_memory_block}""".strip()

    system_prompt = conversational_prompt if is_conversational else standard_prompt

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

