"""ContextBuilder — replicates TypeScript ContextManager faithfully.
Builds the optimal system prompt and message list for every conversation turn,
integrating session memory, topic context, rolling summaries, and retrieved historical exchanges.
"""
from __future__ import annotations

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

    # 1. Preferences & Long-term memories
    preferences = await store.get_preferences()
    pref_summary = "\n".join(f"• {k}: {v}" for k, v in preferences.items())

    recalled = await store.recall(user_message)
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

    if session_id:
        session_data = await store.get_session(session_id)
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
                    interrupted_block = f'\n\n[Interrupted Answer Notice]\nThe previous answer was interrupted part-way through: "{last_assistant["content"]}".\nIf the user says continue / go on, resume from that partial answer, do not restart the topic and do not claim it never happened.'

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
3. Resumption: If the user says "continue", "go on", or resumes after a pause/reload, pick up smoothly from the previous answer or partial answer without starting from scratch. A natural brief resumption cue like "Picking up where we left off — you were asking about X" is welcome when resuming.
4. Fresh Sessions: In a fresh session without prior exchanges, do not invent or reference topics from other sessions."""

    long_term_blocks = []
    if pref_summary:
        long_term_blocks.append(f"[Known User Preferences (Long-term profile)]\n{pref_summary}")
    if recall_summary:
        long_term_blocks.append(f"[Relevant Long-Term Memories (Cross-session knowledge)]\n{recall_summary}")
    long_term_memory_block = ("\n\n" + "\n\n".join(long_term_blocks)) if long_term_blocks else ""

    # Conversational Prompt
    conversational_prompt = f"""You are a warm, articulate, intelligent, and deeply helpful AI assistant and personal companion.
{temporal_context}

You are speaking aloud through an expressive 3D avatar. Talk like an intelligent, charismatic, and authentic friend having a live conversation.

Critical Spoken Voice Rules:
1. Adaptive Answering Effort & Length:
- Match your response length and reasoning depth dynamically to the complexity of the question.
- For small, simple, or straightforward questions (such as greetings, basic arithmetic like 2+2, single-fact queries, yes/no, definitions, or quick checks): Give a direct, punchy, 1-sentence answer (or 2 short sentences at most) with zero filler. Never give lengthy answers, background exposition, or unsolicited essays to small questions.
- For medium questions: Give 2 to 3 concise, articulate spoken sentences.
- For complex, analytical, multi-step, or philosophical questions: Scale up your reasoning effort and depth, providing a thorough, structured, and insightful multi-sentence explanation.
2. Automatic Sentence & Typo Auto-Correction:
- Users interact via voice speech-to-text, which frequently introduces phonetic mishearings, garbled words, spelling errors, or dropped syllables (e.g., 'wether in pares' -> 'weather in Paris', 'whats two pul two' -> 'what is 2 plus 2', 'supper bowl' -> 'Super Bowl').
- Automatically infer the user's true intended question, silently correct the sentence in your mind, and answer the intended question directly and accurately. Never scold or lecture the user about errors.
3. Direct & Warm: Answer the user's question directly, accurately, and naturally.
4. Zero Robotic Boilerplate: NEVER say "How may I assist you today", "I am ready to help", "As an AI language model", or "Is there anything else I can do for you".
5. Pure Spoken English: NEVER output markdown, asterisks (*), hashtags (#), bullet points, or numbered lists. Every single word will be spoken aloud by a neural voice synthesizer.
{session_context_block}{last_exchange_block}{interrupted_block}{retrieved_context_block}{continuity_directive}{long_term_memory_block}""".strip()

    # Standard Agent Prompt
    standard_prompt = f"""You are an intelligent, articulate, and highly knowledgeable AI Assistant and personal companion.
{temporal_context}
You possess deep, comprehensive knowledge across all fields: science, history, geography, philosophy, technology, arts, current affairs, world events, mathematics, and daily life.

Capabilities & Guidelines:
- Adaptive Effort & Length: For simple or small queries, answer directly in 1 crisp sentence without unnecessary fluff. For complex reasoning or multi-step questions, scale reasoning effort up and provide thorough depth.
- Automatic Sentence Auto-Correction: Automatically infer the true intended sentence and question when voice speech-to-text introduces phonetic mishearings or typos (e.g., 'wether in pares' -> 'weather in Paris'), and answer directly.
- Answer ALL questions thoroughly, accurately, and engagingly. You are a universal conversational intelligence—never restrict yourself to only system info or workspace topics.
- For ongoing current events, live news, recent technology updates, or real-time facts, use the web_search tool to look up live information, then synthesize a clear, comprehensive spoken response.
- For weather forecasts or meteorological predictions for any location, use the predict_weather tool.
- Only inspect host computer hardware, CPU, or RAM when the user explicitly asks about their computer resources or hardware specs.
- Provide natural, satisfying, and articulate answers suitable for spoken conversation.
- Always focus on achieving the user's goal directly and accurately.
- Never use markdown asterisks, hashtags, or bullet lists in your spoken response.
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

