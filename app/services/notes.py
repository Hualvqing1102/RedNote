"""笔记数据层：CRUD、收藏夹归属、搜索（M1 用 LIKE，M3 升级 FTS5）。"""
from __future__ import annotations

import json
import sqlite3
import time
from pathlib import Path
from typing import Any

from app.db import connect

# 允许在更新接口中修改的字段（notes 表内字段）
PATCHABLE = {
    "title", "summary", "content", "points", "comments",
    "source_url", "source_snapshot", "folder_id",
}

MAX_TEXT = 20000  # 注释正文上限
MAX_CARDS = 100  # 单篇注释卡片数上限
MAX_LINKS = 20  # 每张卡片相关链接上限


def _now() -> int:
    return int(time.time())


def _points_to_json(points: Any) -> str:
    if isinstance(points, list):
        return json.dumps(points, ensure_ascii=False)
    return "[]"


def _comments_to_json(comments: Any) -> str:
    """把客户端提交的注释卡片规整为可持久化的 JSON。

    每张卡片：{id, text, links:[{title, url}], anchor?}；anchor 为锚定段落序号，
    anchor 与数组顺序共同决定注释在正文中的展示位置。
    """
    if not isinstance(comments, list):
        return "[]"

    def _clean_link(item: Any) -> dict[str, str] | None:
        if not isinstance(item, dict):
            return None
        url = str(item.get("url") or "").strip()
        if not url:
            return None
        title = str(item.get("title") or "").strip() or url
        return {"title": title[:1000], "url": url[:1000]}

    cards = []
    for raw in comments[:MAX_CARDS]:
        if not isinstance(raw, dict):
            continue
        text = str(raw.get("text") or "").strip()[:MAX_TEXT]
        links: list[dict[str, str]] = []
        for item in (raw.get("links") or [])[:MAX_LINKS]:
            cleaned = _clean_link(item)
            if cleaned:
                links.append(cleaned)
        if not text and not links:
            continue
        card: dict[str, Any] = {
            "id": str(raw.get("id") or f"c{_now()}")[:80],
            "text": text,
            "links": links,
        }
        anchor = raw.get("anchor")
        if isinstance(anchor, (int, float)) and not isinstance(anchor, bool) and anchor >= 0:
            card["anchor"] = int(anchor)
        cards.append(card)
    return json.dumps(cards, ensure_ascii=False)


def _row_to_note(row: sqlite3.Row, conn: sqlite3.Connection) -> dict[str, Any]:
    note = dict(row)
    try:
        note["points"] = json.loads(note.get("points") or "[]")
    except json.JSONDecodeError:
        note["points"] = []
    try:
        note["comments"] = json.loads(note.get("comments") or "[]")
    except json.JSONDecodeError:
        note["comments"] = []
    # 附带收藏夹名称，便于展示
    folder_id = note.get("folder_id")
    note["folder_name"] = ""
    if folder_id is not None:
        folder = conn.execute("SELECT name FROM folders WHERE id = ?", (folder_id,)).fetchone()
        if folder:
            note["folder_name"] = folder["name"]
        else:
            note["folder_id"] = None
    return note


def _fetch_note(conn: sqlite3.Connection, note_id: int) -> dict[str, Any] | None:
    row = conn.execute("SELECT * FROM notes WHERE id = ?", (note_id,)).fetchone()
    return _row_to_note(row, conn) if row else None


def create_note(db_path: str | Path, data: dict[str, Any]) -> dict[str, Any]:
    path = Path(db_path)
    now = _now()
    folder_id = data.get("folder_id")
    if not isinstance(folder_id, int) or isinstance(folder_id, bool):
        folder_id = None
    with connect(path) as conn:
        cur = conn.execute(
            """
            INSERT INTO notes (title, summary, content, points, comments, source_url,
                               source_snapshot, folder_id, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                (data.get("title") or "").strip() or "无标题",
                data.get("summary") or "",
                data.get("content") or "",
                _points_to_json(data.get("points", [])),
                _comments_to_json(data.get("comments", [])),
                data.get("source_url") or "",
                data.get("source_snapshot") or "",
                folder_id,
                now,
                now,
            ),
        )
        return _fetch_note(conn, cur.lastrowid)


def get_note(db_path: str | Path, note_id: int) -> dict[str, Any] | None:
    with connect(db_path) as conn:
        return _fetch_note(conn, note_id)


def update_note(db_path: str | Path, note_id: int, patch: dict[str, Any]) -> dict[str, Any] | None:
    if not patch:
        raise ValueError("没有需要更新的内容")

    path = Path(db_path)
    fields = {k: v for k, v in patch.items() if k in PATCHABLE}

    if not fields:
        raise ValueError("没有需要更新的内容")

    if "points" in fields:
        fields["points"] = _points_to_json(fields["points"])
    if "comments" in fields:
        fields["comments"] = _comments_to_json(fields["comments"])
    if "folder_id" in fields:
        folder_id = fields["folder_id"]
        if not isinstance(folder_id, int) or isinstance(folder_id, bool):
            fields["folder_id"] = None

    with connect(path) as conn:
        if not conn.execute("SELECT 1 FROM notes WHERE id = ?", (note_id,)).fetchone():
            return None
        sets = ", ".join(f"{k} = ?" for k in fields)
        conn.execute(
            f"UPDATE notes SET {sets}, updated_at = ? WHERE id = ?",
            (*fields.values(), _now(), note_id),
        )
        return _fetch_note(conn, note_id)


def delete_note(db_path: str | Path, note_id: int) -> bool:
    with connect(db_path) as conn:
        cur = conn.execute("DELETE FROM notes WHERE id = ?", (note_id,))
        return cur.rowcount > 0


def list_notes(db_path: str | Path, q: str = "", folder: int | None = None) -> list[dict[str, Any]]:
    sql = "SELECT * FROM notes WHERE 1=1"
    params: list[Any] = []
    if q:
        sql += " AND (title LIKE ? OR summary LIKE ? OR content LIKE ?)"
        like = f"%{q}%"
        params += [like, like, like]
    if folder is not None:
        sql += " AND folder_id = ?"
        params.append(folder)
    sql += " ORDER BY created_at DESC"

    with connect(db_path) as conn:
        rows = conn.execute(sql, params).fetchall()
        return [_row_to_note(r, conn) for r in rows]
