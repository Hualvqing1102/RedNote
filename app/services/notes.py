"""笔记数据层：CRUD、标签、搜索（M1 用 LIKE，M3 升级 FTS5）。"""
from __future__ import annotations

import json
import sqlite3
import time
from pathlib import Path
from typing import Any

from app.db import connect

# 允许在更新接口中修改的字段（notes 表内字段）
PATCHABLE = {"title", "summary", "content", "points", "source_url", "source_snapshot"}
TAG_KEY = "tags"


def _now() -> int:
    return int(time.time())


def _points_to_json(points: Any) -> str:
    if isinstance(points, list):
        return json.dumps(points, ensure_ascii=False)
    return "[]"


def _row_to_note(row: sqlite3.Row, conn: sqlite3.Connection) -> dict[str, Any]:
    note = dict(row)
    try:
        note["points"] = json.loads(note.get("points") or "[]")
    except json.JSONDecodeError:
        note["points"] = []
    rows = conn.execute(
        """
        SELECT t.name FROM tags t
        JOIN note_tags nt ON nt.tag_id = t.id
        WHERE nt.note_id = ?
        ORDER BY t.name
        """,
        (note["id"],),
    ).fetchall()
    note["tags"] = [r["name"] for r in rows]
    return note


def _attach_tags(conn: sqlite3.Connection, note_id: int, tags: list[str]) -> None:
    conn.execute("DELETE FROM note_tags WHERE note_id = ?", (note_id,))
    for raw in tags:
        name = (raw or "").strip()
        if not name:
            continue
        conn.execute("INSERT OR IGNORE INTO tags (name) VALUES (?)", (name,))
        tag_id = conn.execute("SELECT id FROM tags WHERE name = ?", (name,)).fetchone()["id"]
        conn.execute(
            "INSERT OR IGNORE INTO note_tags (note_id, tag_id) VALUES (?, ?)", (note_id, tag_id)
        )


def _fetch_note(conn: sqlite3.Connection, note_id: int) -> dict[str, Any] | None:
    row = conn.execute("SELECT * FROM notes WHERE id = ?", (note_id,)).fetchone()
    return _row_to_note(row, conn) if row else None


def create_note(db_path: str | Path, data: dict[str, Any]) -> dict[str, Any]:
    path = Path(db_path)
    now = _now()
    with connect(path) as conn:
        cur = conn.execute(
            """
            INSERT INTO notes (title, summary, content, points, source_url, source_snapshot, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                (data.get("title") or "").strip() or "无标题",
                data.get("summary") or "",
                data.get("content") or "",
                _points_to_json(data.get("points", [])),
                data.get("source_url") or "",
                data.get("source_snapshot") or "",
                now,
                now,
            ),
        )
        note_id = cur.lastrowid
        if data.get(TAG_KEY):
            _attach_tags(conn, note_id, data[TAG_KEY])
        return _fetch_note(conn, note_id)


def get_note(db_path: str | Path, note_id: int) -> dict[str, Any] | None:
    with connect(db_path) as conn:
        return _fetch_note(conn, note_id)


def update_note(db_path: str | Path, note_id: int, patch: dict[str, Any]) -> dict[str, Any] | None:
    if not patch:
        raise ValueError("没有需要更新的内容")

    path = Path(db_path)
    fields = {k: v for k, v in patch.items() if k in PATCHABLE}
    new_tags = patch.get(TAG_KEY)

    if not fields and new_tags is None:
        raise ValueError("没有需要更新的内容")

    with connect(path) as conn:
        if not conn.execute("SELECT 1 FROM notes WHERE id = ?", (note_id,)).fetchone():
            return None
        if "points" in fields:
            fields["points"] = _points_to_json(fields["points"])
        if fields:
            sets = ", ".join(f"{k} = ?" for k in fields)
            conn.execute(
                f"UPDATE notes SET {sets}, updated_at = ? WHERE id = ?",
                (*fields.values(), _now(), note_id),
            )
        if new_tags is not None:
            _attach_tags(conn, note_id, new_tags)
        return _fetch_note(conn, note_id)


def delete_note(db_path: str | Path, note_id: int) -> bool:
    with connect(db_path) as conn:
        cur = conn.execute("DELETE FROM notes WHERE id = ?", (note_id,))
        deleted = cur.rowcount > 0
        if deleted:
            # 顺带清理已经没有笔记引用的孤立标签，避免筛选栏出现空标签
            conn.execute(
                """
                DELETE FROM tags WHERE id NOT IN (
                    SELECT DISTINCT tag_id FROM note_tags
                )
                """
            )
        return deleted


def list_notes(db_path: str | Path, q: str = "", tag: str = "") -> list[dict[str, Any]]:
    sql = "SELECT * FROM notes WHERE 1=1"
    params: list[Any] = []
    if q:
        sql += " AND (title LIKE ? OR summary LIKE ? OR content LIKE ?)"
        like = f"%{q}%"
        params += [like, like, like]
    if tag:
        sql += (
            " AND EXISTS (SELECT 1 FROM note_tags nt JOIN tags t ON t.id = nt.tag_id"
            " WHERE nt.note_id = notes.id AND t.name = ?)"
        )
        params.append(tag)
    sql += " ORDER BY created_at DESC"

    with connect(db_path) as conn:
        rows = conn.execute(sql, params).fetchall()
        return [_row_to_note(r, conn) for r in rows]


def list_tags(db_path: str | Path) -> list[str]:
    with connect(db_path) as conn:
        rows = conn.execute("SELECT name FROM tags ORDER BY name").fetchall()
        return [r["name"] for r in rows]
