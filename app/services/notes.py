"""笔记数据层：CRUD、收藏夹归属、全文搜索(FTS5)、回收站(软删除)、附件归档。"""
from __future__ import annotations

import json
import re
import sqlite3
import time
import uuid
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
MAX_ATTACHMENTS = 50  # 单篇附件数上限
MAX_ATTACHMENT_BYTES = 80 * 1024 * 1024
ALLOWED_FILE_EXTS = {
    ".pdf", ".docx", ".doc", ".txt", ".md", ".epub",
    ".csv", ".xlsx", ".pptx",
    ".png", ".jpg", ".jpeg", ".gif", ".webp",
}


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
    for col in ("points", "comments", "files"):
        try:
            note[col] = json.loads(note.get(col) or "[]")
        except json.JSONDecodeError:
            note[col] = []
    note["deleted"] = note.get("deleted_at") is not None
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


def get_note(db_path: str | Path, note_id: int, *, allow_deleted: bool = False) -> dict[str, Any] | None:
    """取单篇笔记；默认已进回收站的返回 None(当作不存在)。"""
    with connect(db_path) as conn:
        row = conn.execute("SELECT * FROM notes WHERE id = ?", (note_id,)).fetchone()
        if not row:
            return None
        if not allow_deleted and row["deleted_at"] is not None:
            return None
        return _row_to_note(row, conn)


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
    """移入回收站(软删除)：返回是否成功。"""
    with connect(db_path) as conn:
        cur = conn.execute(
            "UPDATE notes SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL",
            (_now(), _now(), note_id),
        )
        return cur.rowcount > 0


def restore_note(db_path: str | Path, note_id: int) -> dict[str, Any] | None:
    """从回收站恢复；成功返回恢复后的笔记。"""
    with connect(db_path) as conn:
        cur = conn.execute(
            "UPDATE notes SET deleted_at = NULL, updated_at = ? WHERE id = ? AND deleted_at IS NOT NULL",
            (_now(), note_id),
        )
        if cur.rowcount == 0:
            return None
        return _fetch_note(conn, note_id)


def purge_note(db_path: str | Path, note_id: int) -> bool:
    """彻底删除(物理删除，含附件目录)。"""
    with connect(db_path) as conn:
        cur = conn.execute("DELETE FROM notes WHERE id = ?", (note_id,))
        if cur.rowcount:
            _remove_attachment_dir(db_path, note_id)
            return True
        return False


def empty_trash(db_path: str | Path) -> int:
    """清空回收站，返回删除条数。"""
    with connect(db_path) as conn:
        rows = conn.execute("SELECT id FROM notes WHERE deleted_at IS NOT NULL").fetchall()
        conn.execute("DELETE FROM notes WHERE deleted_at IS NOT NULL")
        for row in rows:
            _remove_attachment_dir(db_path, row["id"])
        return len(rows)


def _fts_search(
    conn: sqlite3.Connection,
    query: str,
    folder: int | None,
) -> list[dict[str, Any]] | None:
    """用 FTS5 索引搜索并按相关度排序；不适用(无索引/词太短)时返回 None 让调用方走 LIKE。

    trigram 分词要求单个词 ≥3 个字符才能命中；标题(10) > 摘要(2) > 正文(1) 加权。
    多个词用空格分隔，按“同时包含”匹配。
    """
    terms = [t for t in re.split(r"\s+", query) if t]
    if not terms or any(len(t) < 3 for t in terms):
        return None
    if not conn.execute(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name='notes_fts'"
    ).fetchone():
        return None
    # 去掉 FTS 语法特殊字符后按短语查询(去掉引号避免截断)
    phrases = ['"' + re.sub(r'["\\]', "", t) + '"' for t in terms]
    params: list[Any] = [" ".join(phrases)]
    sql = (
        "SELECT n.* FROM notes_fts AS f "
        "JOIN notes AS n ON n.id = f.rowid "
        "WHERE notes_fts MATCH ? AND n.deleted_at IS NULL"
    )
    if folder is not None:
        sql += " AND n.folder_id = ?"
        params.append(folder)
    sql += " ORDER BY bm25(notes_fts, 10.0, 2.0, 1.0) LIMIT 300"
    return [_row_to_note(r, conn) for r in conn.execute(sql, params).fetchall()]


def list_notes(
    db_path: str | Path,
    q: str = "",
    folder: int | None = None,
    *,
    deleted: bool = False,
) -> list[dict[str, Any]]:
    """笔记列表。deleted=True 时返回回收站内的笔记(不看 q/folder)。"""
    with connect(db_path) as conn:
        if deleted:
            rows = conn.execute(
                "SELECT * FROM notes WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC"
            ).fetchall()
            return [_row_to_note(r, conn) for r in rows]

        query = q.strip()
        if query:
            fts_rows = _fts_search(conn, query, folder)
            if fts_rows is not None:
                return fts_rows
        # LIKE 回退(无索引环境 / 1-2 字的短词)
        sql = "SELECT * FROM notes WHERE deleted_at IS NULL"
        params: list[Any] = []
        if query:
            sql += " AND (title LIKE ? OR summary LIKE ? OR content LIKE ?)"
            like = f"%{query}%"
            params += [like, like, like]
        if folder is not None:
            sql += " AND folder_id = ?"
            params.append(folder)
        sql += " ORDER BY created_at DESC"
        rows = conn.execute(sql, params).fetchall()
        return [_row_to_note(r, conn) for r in rows]


# ---------------------------------------------------------------- 附件归档

# 附件存数据目录下的 attachments/{note_id}/ 内，文件名只用不可预测 token，避免路径穿越。


def attachments_dir(db_path: str | Path) -> Path:
    return Path(db_path).resolve().parent / "attachments"


def _note_dir(db_path: str | Path, note_id: int) -> Path:
    return attachments_dir(db_path) / str(note_id)


def _remove_attachment_dir(db_path: str | Path, note_id: int) -> None:
    import shutil

    shutil.rmtree(_note_dir(db_path, note_id), ignore_errors=True)


def _files_json(files: list[dict[str, Any]]) -> str:
    return json.dumps(files[:MAX_ATTACHMENTS], ensure_ascii=False)


def list_attachments(db_path: str | Path, note_id: int) -> list[dict[str, Any]]:
    with connect(db_path) as conn:
        row = conn.execute("SELECT files FROM notes WHERE id = ?", (note_id,)).fetchone()
    if not row:
        return []
    try:
        return json.loads(row["files"] or "[]")
    except json.JSONDecodeError:
        return []


def add_attachment(
    db_path: str | Path,
    note_id: int,
    filename: str,
    data: bytes,
) -> dict[str, Any]:
    """把文件归档到笔记(data 目录 attachments/)。返回该笔记的完整数据(含 files)。"""
    if len(data) > MAX_ATTACHMENT_BYTES:
        raise ValueError(f"附件过大：上限 {MAX_ATTACHMENT_BYTES // (1024 * 1024)} MB")
    name = Path(filename or "file").name.strip() or "file"
    ext = Path(name).suffix.lower()
    if ext not in ALLOWED_FILE_EXTS:
        raise ValueError(f"不支持的附件格式：{ext or '未知'}(允许：PDF/DOCX/文本/表格/图片等)")
    token = uuid.uuid4().hex[:16]
    saved = _note_dir(db_path, note_id) / f"{token}{ext}"
    with connect(db_path) as conn:
        if not conn.execute(
            "SELECT 1 FROM notes WHERE id = ? AND deleted_at IS NULL", (note_id,)
        ).fetchone():
            raise ValueError("笔记不存在")
        files = list_attachments(db_path, note_id)
        if len(files) >= MAX_ATTACHMENTS:
            raise ValueError(f"单篇笔记最多 {MAX_ATTACHMENTS} 个附件")
        entry = {"id": token, "name": name, "size": len(data), "added_at": _now()}
        files.append(entry)
        saved.parent.mkdir(parents=True, exist_ok=True)
        try:
            saved.write_bytes(data)
        except OSError as exc:
            raise ValueError(f"写入附件失败：{exc}") from exc
        conn.execute(
            "UPDATE notes SET files = ?, updated_at = ? WHERE id = ?",
            (_files_json(files), _now(), note_id),
        )
        return _fetch_note(conn, note_id)


def attachment_file(db_path: str | Path, note_id: int, token: str) -> tuple[Path, str] | None:
    """按 token 找附件文件与原始文件名；未找到返回 None。"""
    for entry in list_attachments(db_path, note_id):
        if entry.get("id") == token:
            ext = Path(entry.get("name", "file")).suffix.lower()
            path = _note_dir(db_path, note_id) / f"{token}{ext}"
            if path.is_file():
                return path, str(entry.get("name") or "file")
            return None
    return None


def remove_attachment(db_path: str | Path, note_id: int, token: str) -> bool:
    """删除附件(文件+元数据)；返回是否删除成功。"""
    with connect(db_path) as conn:
        if not conn.execute("SELECT 1 FROM notes WHERE id = ?", (note_id,)).fetchone():
            return False
        files = list_attachments(db_path, note_id)
        rest = [f for f in files if f.get("id") != token]
        if len(rest) == len(files):
            return False
        try:
            ext = Path(next(f["name"] for f in files if f.get("id") == token)).suffix.lower()
        except StopIteration:
            ext = ""
        path = _note_dir(db_path, note_id) / f"{token}{ext}"
        if path.is_file():
            try:
                path.unlink()
            except OSError:
                pass
        conn.execute(
            "UPDATE notes SET files = ?, updated_at = ? WHERE id = ?",
            (_files_json(rest), _now(), note_id),
        )
        return True
