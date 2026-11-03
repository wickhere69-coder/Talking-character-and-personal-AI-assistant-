"""WebSocket end-to-end integration test."""
import asyncio
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from fastapi.testclient import TestClient
from main import app
from memory.store import get_memory_store


def test_websocket():
    print("=== Testing FastAPI WebSocket Integration ===")
    
    with TestClient(app) as client:
        # 1. Health check
        res = client.get("/health")
        print(f"[OK] Health endpoint: {res.status_code} - {res.json()['model']}")
        assert res.status_code == 200
        
        # 2. REST Sessions endpoint
        res_sess = client.get("/api/agent/sessions")
        print(f"[OK] Sessions endpoint: {res_sess.status_code} - {len(res_sess.json()['sessions'])} session(s)")
        assert res_sess.status_code == 200
        
        # 3. WebSocket conversation test
        test_session_id = "test_ws_session"
        events_received = []
        
        with client.websocket_connect(f"/ws/{test_session_id}") as websocket:
            print("[OK] WebSocket connected!")
            
            # Send message
            req_payload = {
                "type": "message",
                "content": "Hello! What is 3 times 3? Answer in one short sentence.",
                "request_id": "req_ws_test_01",
                "config": {"mode": "conversational"},
            }
            websocket.send_text(json.dumps(req_payload))
            
            # Receive events until assistant.done
            while True:
                msg_text = websocket.receive_text()
                event = json.loads(msg_text)
                events_received.append(event)
                event_type = event.get("type")
                
                if event_type == "assistant.delta":
                    print(f"  [WS DELTA]: {event.get('content')}")
                elif event_type == "assistant.done":
                    print(f"  [WS DONE]: Full response = '{event.get('content')}'")
                    break
                elif event_type == "assistant.error":
                    print(f"  [WS ERROR]: {event.get('error')}")
                    break
                    
        types = [e.get("type") for e in events_received]
        print(f"\nAll event types received: {types}")
        assert "assistant.started" in types, "Should receive assistant.started"
        assert "assistant.done" in types, "Should receive assistant.done"
        
        print("\n>>> WEBSOCKET INTEGRATION TEST PASSED! <<<")


if __name__ == "__main__":
    test_websocket()

