"""Backend API tests for KuohFlow Rias Gremory chat."""
import os
import uuid
import json
import requests
import pytest

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', 'http://127.0.0.1:8000').rstrip('/')
API = f"{BASE_URL}/api"


@pytest.fixture
def session_id():
    return f"TEST_{uuid.uuid4().hex[:12]}"


@pytest.fixture(autouse=False)
def cleanup(session_id):
    yield
    try:
        requests.delete(f"{API}/chat/history", params={"session_id": session_id}, timeout=15)
    except Exception:
        pass


# --- Health / root ---
def test_root():
    r = requests.get(f"{API}/", timeout=15)
    assert r.status_code == 200
    assert r.json().get("message") == "Hello World"


# --- Status CRUD-lite ---
def test_status_create_and_list():
    payload = {"client_name": "TEST_kuohflow"}
    r = requests.post(f"{API}/status", json=payload, timeout=15)
    assert r.status_code == 200
    data = r.json()
    assert data["client_name"] == "TEST_kuohflow"
    assert "id" in data and "timestamp" in data

    r2 = requests.get(f"{API}/status", timeout=15)
    assert r2.status_code == 200
    assert isinstance(r2.json(), list)
    assert any(s.get("client_name") == "TEST_kuohflow" for s in r2.json())


# --- Chat validation ---
def test_chat_stream_requires_message(session_id):
    r = requests.post(f"{API}/chat/stream", json={"session_id": session_id, "message": ""}, timeout=15)
    assert r.status_code == 400


def test_chat_stream_requires_session():
    r = requests.post(f"{API}/chat/stream", json={"session_id": "", "message": "hi"}, timeout=15)
    assert r.status_code == 400


# --- Chat streaming happy path ---
def test_chat_stream_returns_sse_and_persists(session_id, cleanup):
    payload = {"session_id": session_id, "message": "I miss you so much today", "total_tasks": 5, "completed_tasks": 2, "xp": 40, "rank": "Low-Class Devil"}
    with requests.post(f"{API}/chat/stream", json=payload, stream=True, timeout=60) as r:
        assert r.status_code == 200
        ctype = r.headers.get("content-type", "")
        assert "text/event-stream" in ctype
        events = []
        deltas = []
        for line in r.iter_lines(decode_unicode=True):
            if not line:
                continue
            if line.startswith("data: "):
                data = json.loads(line[6:])
                events.append(data)
                if data.get("type") == "delta":
                    deltas.append(data.get("delta", ""))
                if data.get("type") == "done":
                    break
                if data.get("type") == "error":
                    pytest.fail(f"stream error: {data}")
        assert any(e.get("type") == "start" for e in events)
        assert any(e.get("type") == "done" for e in events)
        full = "".join(deltas).strip()
        assert len(full) > 0

    # History persistence
    h = requests.get(f"{API}/chat/history", params={"session_id": session_id}, timeout=15)
    assert h.status_code == 200
    msgs = h.json().get("messages", [])
    roles = [m["role"] for m in msgs]
    assert "user" in roles
    assert "rias" in roles
    # No mongo _id leaked
    for m in msgs:
        assert "_id" not in m


# --- History empty for unknown session ---
def test_chat_history_empty():
    sid = f"TEST_empty_{uuid.uuid4().hex[:8]}"
    r = requests.get(f"{API}/chat/history", params={"session_id": sid}, timeout=15)
    assert r.status_code == 200
    assert r.json() == {"messages": []}


# --- Clear ---
def test_chat_clear(session_id):
    # Insert something first via status? Need a real chat message. Use stream then clear.
    payload = {"session_id": session_id, "message": "hello darling", "total_tasks": 0, "completed_tasks": 0, "xp": 0, "rank": "Low-Class Devil"}
    with requests.post(f"{API}/chat/stream", json=payload, stream=True, timeout=60) as r:
        for line in r.iter_lines(decode_unicode=True):
            if line and line.startswith("data: "):
                d = json.loads(line[6:])
                if d.get("type") in ("done", "error"):
                    break
    d = requests.delete(f"{API}/chat/history", params={"session_id": session_id}, timeout=15)
    assert d.status_code == 200
    assert d.json().get("cleared") is True

    h = requests.get(f"{API}/chat/history", params={"session_id": session_id}, timeout=15)
    assert h.json().get("messages") == []
