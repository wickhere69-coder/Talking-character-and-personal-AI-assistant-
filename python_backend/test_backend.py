"""Self-test script for the Python AI backend."""
import asyncio
import sys
from pathlib import Path

# Add python_backend to path
sys.path.insert(0, str(Path(__file__).parent))

from config import get_settings
from memory.store import get_memory_store
from agent.providers.provider_manager import ProviderManager
from agent.tools import select_relevant_tools, TOOL_DEFINITIONS
from agent.graph import get_agent_graph


async def main():
    print("=== Testing Aura Python AI Backend ===")
    
    # 1. Config
    settings = get_settings()
    print(f"[OK] Port: {settings.port}")
    print(f"[OK] Gemini key configured: {settings.has_gemini}")
    print(f"[OK] Grok key configured: {settings.has_grok}")
    
    # 2. Database & Migration
    store = get_memory_store()
    await store.init_db()
    sessions = await store.list_sessions(include_archived=True)
    print(f"[OK] Database initialized. Found {len(sessions)} session(s).")
    for s in sessions[:3]:
        print(f"     Session: '{s['title']}' (id: {s['id']}, msgs: {s['messageCount']})")
    
    # 3. Tools
    tools = select_relevant_tools("what is the weather in Tokyo?")
    tool_names = [t["name"] for t in tools]
    print(f"[OK] Tool selection for weather query: {tool_names}")
    assert "predict_weather" in tool_names, "predict_weather should be selected"
    
    tools_web = select_relevant_tools("latest news about space exploration")
    web_names = [t["name"] for t in tools_web]
    print(f"[OK] Tool selection for news query: {web_names}")
    assert "web_search" in web_names, "web_search should be selected"

    # 4. Providers
    mgr = ProviderManager()
    status = mgr.key_status()
    print(f"[OK] Provider key status: {status}")

    # 5. LangGraph Compilation
    graph = get_agent_graph()
    print(f"[OK] LangGraph StateGraph compiled successfully! Graph: {type(graph)}")

    print("\n>>> ALL BACKEND TESTS PASSED SUCCESSFULLY! <<<")


if __name__ == "__main__":
    asyncio.run(main())

