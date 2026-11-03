"""End-to-end test of weather tool calling through LangGraph."""
import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from agent.graph import run_agent_turn
from memory.store import get_memory_store


async def main():
    print("=== Testing Weather Tool via LangGraph ===")
    store = get_memory_store()
    await store.init_db()
    
    session = await store.create_session("Weather Test", "Weather")
    session_id = session["id"]

    sentences = []
    
    async def on_sentence(chunk: str):
        print(f"  [STREAM CHUNK]: {chunk}")
        sentences.append(chunk)

    result = await run_agent_turn(
        user_message="What is the weather in Paris right now?",
        session_id=session_id,
        request_id="test_req_weather",
        config={"mode": "conversational"},
        on_chunk=on_sentence,
    )

    print(f"\nFinal Response: {result['response']}")
    print(f"Tool Results: {result['tool_results']}")
    assert len(result['tool_results']) > 0, "Tool results should not be empty"
    print("\n>>> WEATHER TOOL E2E TEST PASSED! <<<")


if __name__ == "__main__":
    asyncio.run(main())

