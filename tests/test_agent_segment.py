"""阅读页选中段落 Agent 动作(/api/agent/segment)测试。"""
from __future__ import annotations

import asyncio

import httpx
import pytest

from app.services.providers import OpenAICompatibleProvider

NOTE = {
    "title": "注意力机制",
    "summary": "",
    "content": "注意力机制让模型在处理当前位置时，关注序列中更重要的其他位置。\n\n这是 Transformer 的核心。",
    "points": [],
    "source_url": "",
    "source_snapshot": "",
}


def _mk_note(client):
    return client.post("/api/notes", json=NOTE).json()["id"]


def test_segment_explain_translate_ask_mock(client):
    nid = _mk_note(client)
    for action, payload in (
        ("explain", {}),
        ("translate", {}),
        ("ask", {"question": "它解决了什么问题？"}),
    ):
        resp = client.post(
            "/api/agent/segment",
            json={"note_id": nid, "text": "注意力机制让模型关注重要位置。", "action": action, **payload},
        )
        assert resp.status_code == 200, (action, resp.text)
        answer = resp.json()["answer"]
        assert answer and len(answer) > 5


def test_segment_validation(client):
    nid = _mk_note(client)
    base = {"note_id": nid, "text": "某段内容", "action": "explain"}
    assert client.post("/api/agent/segment", json={**base, "action": "foo"}).status_code == 400
    assert client.post("/api/agent/segment", json={**base, "text": "  "}).status_code == 400
    assert (
        client.post("/api/agent/segment", json={**base, "action": "ask", "question": "  "}).status_code
        == 400
    )
    assert client.post("/api/agent/segment", json={"note_id": 99999, "text": "x", "action": "explain"}).status_code == 404


def test_segment_long_text_truncated(client):
    nid = _mk_note(client)
    long_text = "长内容" * 5000  # >6000 字，服务端应截断而不是报错
    resp = client.post(
        "/api/agent/segment",
        json={"note_id": nid, "text": long_text, "action": "explain"},
    )
    assert resp.status_code == 200


def _run(coro):
    return asyncio.run(coro)


def test_segment_real_provider_failure_is_502(client, monkeypatch):
    nid = _mk_note(client)
    client.put(
        "/api/settings",
        json={"provider": "openai", "openai": {"base_url": "https://x/v1", "model": "m", "api_key": "sk"}},
    )

    def fail_provider(cfg):
        return OpenAICompatibleProvider(
            "https://x/v1", "m", "sk",
            http_client=httpx.AsyncClient(
                transport=httpx.MockTransport(lambda r: httpx.Response(500, json={"error": "boom"}))
            ),
        )

    monkeypatch.setattr("app.services.providers.build_provider", fail_provider)
    resp = client.post(
        "/api/agent/segment",
        json={"note_id": nid, "text": "某段", "action": "explain"},
    )
    assert resp.status_code == 502
    assert "boom" in resp.json()["detail"]
