"""Agent 写入桥(/api/import/agent)测试。"""
from __future__ import annotations


def _payload(**over):
    base = {
        "title": "上下文工程讲解",
        "summary": "把给 Agent 的上下文当工程设计",
        "points": ["Prompt 之外还有 System/工具上下文", "上下文要结构化"],
        "content": "# 讲解\n\n把上下文工程视为……",
        "source_url": "https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents",
        "source_name": "Anthropic 官方文章",
    }
    base.update(over)
    return base


def test_import_agent_creates_note(client):
    resp = client.post("/api/import/agent", json=_payload())
    assert resp.status_code == 201
    note = resp.json()
    assert note["title"] == "上下文工程讲解"
    assert note["summary"] == "把给 Agent 的上下文当工程设计"
    assert note["points"] == ["Prompt 之外还有 System/工具上下文", "上下文要结构化"]
    assert "# 讲解" in note["content"]
    assert note["source_url"].startswith("https://www.anthropic.com")
    # 笔记进入普通列表与搜索
    found = client.get("/api/notes", params={"q": "上下文工程"}).json()
    assert any(n["id"] == note["id"] for n in found)


def test_import_agent_into_folder(client):
    folder = client.post("/api/folders", json={"name": "AI 阅读"}).json()
    resp = client.post("/api/import/agent", json=_payload(folder_id=folder["id"]))
    assert resp.status_code == 201
    assert resp.json()["folder_id"] == folder["id"]
    assert resp.json()["folder_name"] == "AI 阅读"


def test_import_agent_defaults_and_empty_content(client):
    # 无标题/来源也能建，正文必填
    ok = client.post("/api/import/agent", json=_payload(title="", source_url="", points=[]))
    assert ok.status_code == 201
    assert ok.json()["title"] == "无标题"
    assert ok.json()["points"] == []
    bad = client.post("/api/import/agent", json=_payload(content="   "))
    assert bad.status_code == 400


def test_import_agent_then_attach_file(client):
    """导入后来源文件可再作为附件归档(与原流程一致)。"""
    note = client.post("/api/import/agent", json=_payload()).json()
    nid = note["id"]
    up = client.post(
        f"/api/notes/{nid}/files",
        files={"file": ("paper.pdf", b"%PDF-1.4 x", "application/pdf")},
    )
    assert up.status_code == 200
    assert up.json()["files"][0]["name"] == "paper.pdf"
