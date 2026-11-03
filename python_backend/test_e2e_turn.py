"""End-to-end test of LangGraph agent turn with streaming."""
import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from agent.graph import run_agent_turn
from memory.store import get_memory_store


async def main():
    print("=== Testing LangGraph Streaming Agent Turn ===")
    store = get_memory_store()
    await store.init_db()
    
    session = await store.create_session("Test E2E", "Software Engineering")
    session_id = session["id"]
    print(f"Created test session: {session_id}")

    sentences = []
    
    async def on_sentence(chunk: str):
        print(f"  [STREAM CHUNK]: {chunk}")
        sentences.append(chunk)

    result = await run_agent_turn(
        user_message="Hello! What is 2 plus 2? Answer in one short sentence.",
        session_id=session_id,
        request_id="test_req_001",
        config={"mode": "conversational"},
        on_chunk=on_sentence,
    )

    print(f"\nFinal Response: {result['response']}")
    print(f"Model Used: {result['model_used']}")
    print(f"Total Sentences/Chunks Streamed: {len(sentences)}")

    # Verify message persistence
    msgs = await store.get_messages(session_id)
    print(f"Persisted messages in session: {len(msgs)}")
    assert len(msgs) == 2, f"Expected 2 messages (user + assistant), got {len(msgs)}"
    print("[OK] Turn successfully persisted in SQLite database!")
    
    print("\n>>> E2E TEST PASSED! <<<")


if __name__ == "__main__":
    asyncio.run(main())

