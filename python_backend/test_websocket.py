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


def test_barge_in_and_resumption():
    print("\n=== Testing Real-Time Voice Barge-In & Smart Resumption ===")
    
    with TestClient(app) as client:
        test_session_id = "test_bargein_session"
        
        with client.websocket_connect(f"/ws/{test_session_id}") as websocket:
            print("[OK] Connected for Barge-In test")
            
            # 1. Start a long speech turn
            req_id = "req_barge_01"
            websocket.send_text(json.dumps({
                "type": "message",
                "content": "Tell me a story about a brave knight and a dragon in 5 detailed sentences.",
                "request_id": req_id,
                "config": {"mode": "conversational"},
            }))
            
            # Wait for first delta
            started = False
            first_delta = ""
            while True:
                msg = json.loads(websocket.receive_text())
                if msg.get("type") == "assistant.started":
                    started = True
                elif msg.get("type") == "assistant.delta":
                    first_delta = msg.get("content", "")
                    print(f"  [RECEIVED CLAUSE BEFORE BARGE-IN]: {first_delta}")
                    break
            
            assert started, "Should have started"
            assert first_delta, "Should have received first clause"
            
            # 2. Simulate User Barge-In: Send cancel with spoken_content
            print("  >>> Emulating User Voice Barge-In: Sending cancel event...")
            websocket.send_text(json.dumps({
                "type": "cancel",
                "request_id": req_id,
                "spoken_content": first_delta,
            }))
            
            # Verify cancelled event received
            cancelled_event = None
            while True:
                msg = json.loads(websocket.receive_text())
                if msg.get("type") == "assistant.cancelled":
                    cancelled_event = msg
                    print("  [OK] Received assistant.cancelled event from server!")
                    break
                elif msg.get("type") == "assistant.done":
                    # In case of race
                    break
                    
            assert cancelled_event is not None, "Should receive assistant.cancelled"

        # 3. Verify SQLite DB persists the interrupted status
        store = get_memory_store()
        loop = asyncio.new_event_loop()
        interrupted_msg = loop.run_until_complete(store.get_last_interrupted_message(test_session_id))
        loop.close()
        
        print(f"  [DB CHECK] Last interrupted message in SQLite: {interrupted_msg}")
        assert interrupted_msg is not None, "Message should be marked interrupted in SQLite"
        print("  [OK] Interrupted thought successfully captured in SQLite database!")

        print("\n>>> BARGE-IN & RESUMPTION TEST PASSED! <<<")


if __name__ == "__main__":
    test_websocket()
    test_barge_in_and_resumption()

