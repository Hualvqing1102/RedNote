"""注释卡片(comments)的存储、迁移与接口测试。"""
from __future__ import annotations

import json
import sqlite3

from app.db import init_db
from app.services import notes as svc
from app.services.export import note_to_markdown


def _base() -> dict:
    return {"title": "笔记", "content": "正文"}


# ---------------------------------------------------------------- 迁移


def test_migrate_old_db_adds_comments_column(tmp_path):
    path = tmp_path / "old.db"
    conn = sqlite3.connect(path)
    conn.executescript(
        """
        CREATE TABLE notes (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          title TEXT NOT NULL,
          summary TEXT NOT NULL DEFAULT '',
          content TEXT NOT NULL DEFAULT '',
          points TEXT NOT NULL DEFAULT '[]',
          source_url TEXT NOT NULL DEFAULT '',
          source_snapshot TEXT NOT NULL DEFAULT '',
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );
        """
    )
    conn.execute(
        "INSERT INTO notes (title, content, created_at, updated_at) VALUES ('旧笔记', '旧正文', 1, 1)"
    )
    conn.commit()
    conn.close()

    init_db(path)  # 应自动补列
    conn = sqlite3.connect(path)
    cols = {row[1] for row in conn.execute("PRAGMA table_info(notes)").fetchall()}
    assert "comments" in cols
    conn.close()

    note = svc.get_note(path, 1)
    assert note is not None
    assert note["title"] == "旧笔记"
    assert note["comments"] == []


# ---------------------------------------------------------------- 服务层


def test_default_comments_empty(db_path):
    note = svc.create_note(db_path, _base())
    assert note["comments"] == []


def test_update_comments_persists_and_normalizes(db_path):
    note = svc.create_note(db_path, _base())
    comments = [
        {
            "id": "c1",
            "text": "这一段要重点回看",
            "links": [
                {"title": "官方文档", "url": "https://example.com/doc"},
                {"title": "", "url": "https://example.com/blank"},  # 无标题 → 用 URL 作标题
                {"title": "无地址", "url": "  "},  # 空 URL → 丢弃
            ],
        },
        {"id": "c2", "text": "第二条注释", "links": []},
    ]
    updated = svc.update_note(db_path, note["id"], {"comments": comments})
    assert len(updated["comments"]) == 2
    first = updated["comments"][0]
    assert first["id"] == "c1"
    assert first["text"] == "这一段要重点回看"
    assert len(first["links"]) == 2
    assert first["links"][1] == {"title": "https://example.com/blank", "url": "https://example.com/blank"}
    assert updated["comments"][1]["id"] == "c2"
    # 顺序保持(供排序)
    assert [c["id"] for c in updated["comments"]] == ["c1", "c2"]


def test_update_comments_clears_and_drops_empty_cards(db_path):
    note = svc.create_note(db_path, _base())
    svc.update_note(db_path, note["id"], {"comments": [{"id": "x", "text": "  ", "links": []}]})
    got = svc.get_note(db_path, note["id"])
    assert got["comments"] == []
    cleared = svc.update_note(db_path, note["id"], {"comments": []})
    assert cleared["comments"] == []


# ---------------------------------------------------------------- API


def test_api_patch_comments_roundtrip(client):
    created = client.post("/api/notes", json=_base())
    note_id = created.json()["id"]

    comments = [{"id": "k1", "text": "值得展开", "links": [{"title": "参考", "url": "https://a.b"}]}]
    resp = client.patch(f"/api/notes/{note_id}", json={"comments": comments})
    assert resp.status_code == 200
    assert resp.json()["comments"] == comments

    got = client.get(f"/api/notes/{note_id}").json()
    assert got["comments"][0]["text"] == "值得展开"

    resp = client.patch(f"/api/notes/{note_id}", json={"comments": []})
    assert resp.json()["comments"] == []


def test_api_comments_invalid_type_rejected(client):
    created = client.post("/api/notes", json=_base())
    resp = client.patch(f"/api/notes/{created.json()['id']}", json={"comments": "oops"})
    assert resp.status_code == 422


# ---------------------------------------------------------------- 导出


def test_export_includes_comments(db_path):
    note = svc.create_note(db_path, _base())
    note = svc.update_note(
        db_path,
        note["id"],
        {"comments": [{"id": "z", "text": "我的想法", "links": [{"title": "补充", "url": "https://e.com"}]}]},
    )
    md = note_to_markdown(note)
    assert "## 我的注释与相关链接" in md
    assert "我的想法" in md
    assert "补充: https://e.com" in md


def _json_default_comments_empty(db_path):
    """确保 row 中 comments 的原始 JSON 是 '[]'。"""
    note = svc.create_note(db_path, _base())
    conn = sqlite3.connect(str(db_path))
    raw = conn.execute("SELECT comments FROM notes WHERE id = ?", (note["id"],)).fetchone()[0]
    conn.close()
    assert raw == "[]" and json.loads(raw) == []
