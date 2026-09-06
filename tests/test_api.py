"""REST API 集成测试：走完整请求链路(不联网；Agent 为模拟)。"""
from __future__ import annotations

import pytest

from app.config import frontend_dist_dir

NOTE_PAYLOAD = {
    "title": "API 集成测试笔记",
    "summary": "用于验证接口的笔记",
    "content": "正文第一段。\n\n正文第二段。",
    "points": ["要点一"],
    "source_url": "https://example.com/x",
    "source_snapshot": "原文快照",
}


def test_note_full_lifecycle(client):
    created = client.post("/api/notes", json=NOTE_PAYLOAD)
    assert created.status_code == 201
    note_id = created.json()["id"]
    assert created.json()["title"] == "API 集成测试笔记"

    assert any(n["id"] == note_id for n in client.get("/api/notes").json())

    got = client.get(f"/api/notes/{note_id}").json()
    assert got["source_url"] == "https://example.com/x"

    upd = client.patch(f"/api/notes/{note_id}", json={"title": "改名"})
    assert upd.status_code == 200
    assert upd.json()["title"] == "改名"

    assert client.delete(f"/api/notes/{note_id}").status_code == 204
    assert client.get(f"/api/notes/{note_id}").status_code == 404


def test_search_query(client):
    client.post("/api/notes", json=NOTE_PAYLOAD)
    found = client.get("/api/notes", params={"q": "集成测试"}).json()
    assert len(found) == 1


def test_agent_summarize_mock_without_tags(client):
    resp = client.post(
        "/api/agent/summarize",
        json={"title": "注意力机制", "content": "注意力机制让模型关注重要的位置。这是 Transformer 的核心。"},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["summary"]
    assert len(data["points"]) >= 1
    assert "tags" not in data


def test_agent_explain_mock(client):
    resp = client.post(
        "/api/agent/explain",
        json={"title": "上下文工程", "content": "第一段介绍。\n\n第二段深入。\n\n第三段总结。"},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["title"] == "上下文工程"
    assert len(data["explanation"]) > 20
    assert "第一段介绍。" in data["explanation"] or "第 1 部分" in data["explanation"]


def test_agent_ask_missing_note(client):
    resp = client.post("/api/agent/ask", json={"note_id": 99999, "question": "什么是注意力"})
    assert resp.status_code == 404


def test_collect_bad_url_message(client):
    resp = client.post("/api/collect", json={"url": "not a url"})
    assert resp.status_code == 400


def test_spa_index_and_fallback(client):
    if frontend_dist_dir() is None:
        pytest.skip("前端未构建，跳过静态托管测试")
    index = client.get("/")
    assert index.status_code == 200
    assert "root" in index.text or "index" in index.text.lower()
    # 前端路由路径也回退到 index.html，而不是 404
    fallback = client.get("/some/client/route")
    assert fallback.status_code == 200
    assert fallback.text == index.text
    # API 仍正常，不被 SPA 回退吞掉
    assert client.get("/api/notes").status_code == 200
