"""RedNote MCP 服务器(scripts/rednote_mcp.py)工具逻辑测试。"""
from __future__ import annotations

import json

import pytest

from scripts import rednote_mcp as mcp


@pytest.fixture
def fake_api(monkeypatch):
    """拦截 _request_json，避免访问真实 RedNote。"""
    calls: list[tuple] = []

    def _fake(method: str, path: str, payload: dict | None = None):
        calls.append((method, path, payload))
        if path == "/api/folders" and method == "GET":
            return [{"id": 1, "name": "AI 阅读"}]
        if path == "/api/folders" and method == "POST":
            return {"id": 9, "name": payload["name"]}
        if path.startswith("/api/notes"):
            if method == "GET" and path.startswith("/api/notes/"):
                return {"id": int(path.rsplit("/", 1)[1]), "title": "Transformer", "summary": "s", "points": []}
            if method == "GET":
                return [{"id": 7, "title": "Transformer", "summary": "s", "points": []}]
            return {"id": 12, "title": "导入的笔记", "content": ""}
        if path == "/api/import/agent":
            return {"id": 12, "title": "导入的笔记"}
        return {}

    monkeypatch.setattr(mcp, "_request_json", _fake)
    return calls


def test_tools_list_contains_expected(fake_api):
    names = [t["name"] for t in mcp.TOOLS]
    assert names == ["search_notes", "get_note", "list_folders", "import_note"]


def test_search_notes(fake_api):
    text, err = mcp.execute("search_notes", {"q": "x"})
    assert err is False
    data = json.loads(text)
    assert data[0]["id"] == 7
    assert fake_api[0] == ("GET", "/api/notes?q=x", None)


def test_get_note_and_folders(fake_api):
    text, _ = mcp.execute("get_note", {"id": 7})
    assert json.loads(text)["id"] == 7
    text, _ = mcp.execute("list_folders", {})
    assert json.loads(text)[0]["name"] == "AI 阅读"


def test_import_note_with_folder(fake_api):
    text, err = mcp.execute(
        "import_note",
        {"content": "讲解正文", "title": "T", "folder": "AI 阅读"},
    )
    assert err is False
    assert "id=12" in text
    # 命中已有收藏夹(folder_id=1)，payload 应填上 folder_id
    method, path, payload = fake_api[-1]
    assert (method, path) == ("POST", "/api/import/agent")
    assert payload["content"] == "讲解正文"
    assert payload["folder_id"] == 1


def test_import_note_requires_content(fake_api):
    text, err = mcp.execute("import_note", {"content": "  "})
    assert err is True
    assert "content" in text


def test_unknown_tool(fake_api):
    text, err = mcp.execute("nope", {})
    assert err is True
    assert "未知工具" in text
