"""导出 API 测试：Markdown 导出与 SQLite 备份。"""
from __future__ import annotations

import sqlite3

from app.services import notes as svc
from app.services.export import note_to_markdown, notes_to_markdown


def _make(client) -> list[int]:
    """通过 API 建两条笔记，返回 id。"""
    ids = []
    for title in ["Transformer 笔记", "SQL 优化"]:
        r = client.post(
            "/api/notes",
            json={
                "title": title,
                "summary": f"{title}的摘要",
                "content": f"{title}的正文。\n\n第二段。",
                "points": ["要点甲", "要点乙"],
                "source_url": "https://example.com/x",
            },
        )
        assert r.status_code == 201
        ids.append(r.json()["id"])
    return ids


def test_note_to_markdown_structure(db_path):
    from app.services import folders as folders_svc

    folder = folders_svc.create_folder(db_path, "研究")
    note = svc.create_note(
        db_path,
        {
            "title": "T",
            "summary": "S",
            "content": "正文",
            "points": ["P1"],
            "source_url": "https://e.com",
            "folder_id": folder["id"],
        },
    )
    md = note_to_markdown(note)
    assert md.startswith("# T")
    assert "## 摘要" in md and "S" in md
    assert "## 要点" in md and "- P1" in md
    assert "## 正文" in md
    assert "来源：https://e.com" in md
    assert "收藏夹：研究" in md


def test_notes_to_markdown_separator(db_path):
    a = svc.create_note(db_path, {"title": "A", "content": "x"})
    b = svc.create_note(db_path, {"title": "B", "content": "y"})
    md = notes_to_markdown([a, b])
    assert md.count("---") == 1
    assert "# A" in md and "# B" in md


# ---------------------------------------------------------------- API


def test_export_all_markdown(client):
    _make(client)
    resp = client.get("/api/export/notes.md")
    assert resp.status_code == 200
    assert "text/markdown" in resp.headers["content-type"]
    assert "Transformer 笔记" in resp.text
    assert "SQL 优化" in resp.text
    assert 'filename="rednote-notes.md"' in resp.headers["content-disposition"]


def test_export_single_markdown(client):
    ids = _make(client)
    resp = client.get(f"/api/notes/{ids[0]}/export.md")
    assert resp.status_code == 200
    assert resp.text.startswith("# Transformer 笔记")
    assert "摘要" in resp.text
    assert "SQL" not in resp.text


def test_export_single_missing(client):
    assert client.get("/api/notes/99999/export.md").status_code == 404


def test_backup_db_roundtrip(client):
    ids = _make(client)
    resp = client.get("/api/export/backup.db")
    assert resp.status_code == 200
    assert resp.headers["content-type"] == "application/vnd.sqlite3"
    payload = resp.content
    assert payload.startswith(b"SQLite format 3")

    # 备份可独立打开，且包含已写入的笔记
    tmp = client.app.state.db_path + ".restore"
    with open(tmp, "wb") as fh:
        fh.write(payload)
    try:
        conn = sqlite3.connect(tmp)
        rows = conn.execute("SELECT COUNT(*) FROM notes").fetchone()[0]
        assert rows == len(ids)
        conn.close()
    finally:
        import os

        os.unlink(tmp)
