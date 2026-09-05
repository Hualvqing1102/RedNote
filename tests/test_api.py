"""REST API 集成测试：走完整请求链路（笔记部分不联网，Agent 为模拟）。"""
from __future__ import annotations

NOTE_PAYLOAD = {
    "title": "API 集成测试笔记",
    "summary": "用于验证接口的笔记",
    "content": "正文第一段。\n\n正文第二段。",
    "points": ["要点一"],
    "source_url": "https://example.com/x",
    "source_snapshot": "原文快照",
    "tags": ["测试"],
}


def test_note_full_lifecycle(client):
    # 创建
    resp = client.post("/api/notes", json=NOTE_PAYLOAD)
    assert resp.status_code == 201
    note = resp.json()
    note_id = note["id"]
    assert note["title"] == "API 集成测试笔记"
    assert note["tags"] == ["测试"]

    # 列表
    lst = client.get("/api/notes").json()
    assert any(n["id"] == note_id for n in lst)

    # 详情
    got = client.get(f"/api/notes/{note_id}").json()
    assert got["source_url"] == "https://example.com/x"

    # 更新
    upd = client.patch(f"/api/notes/{note_id}", json={"title": "改名"})
    assert upd.status_code == 200
    assert upd.json()["title"] == "改名"

    # 标签查询
    tagged = client.get("/api/notes", params={"tag": "测试"}).json()
    assert any(n["id"] == note_id for n in tagged)

    # 删除
    assert client.delete(f"/api/notes/{note_id}").status_code == 204
    assert client.get(f"/api/notes/{note_id}").status_code == 404


def test_search_query(client):
    client.post("/api/notes", json=NOTE_PAYLOAD)
    found = client.get("/api/notes", params={"q": "集成测试"}).json()
    assert len(found) == 1


def test_agent_summarize_mock(client):
    resp = client.post(
        "/api/agent/summarize",
        json={"title": "注意力机制", "content": "注意力机制让模型关注重要的位置。这是 Transformer 的核心。深度学习模型大量使用它。"},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["summary"]
    assert "AI" in data["tags"]


def test_agent_ask_missing_note(client):
    resp = client.post("/api/agent/ask", json={"note_id": 99999, "question": "什么是注意力"})
    assert resp.status_code == 404


def test_collect_bad_url_message(client):
    resp = client.post("/api/collect", json={"url": "not a url"})
    assert resp.status_code == 400
