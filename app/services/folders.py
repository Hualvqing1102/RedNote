"""收藏夹(folders)数据层。

用户自建分类，替代早期标签体系。删除收藏夹时，其下笔记自动回到“未分类”。
"""
from __future__ import annotations

import time
from pathlib import Path
from typing import Any

from app.db import connect


def _now() -> int:
    return int(time.time())


def list_folders(db_path: str | Path) -> list[dict[str, Any]]:
    with connect(db_path) as conn:
        rows = conn.execute(
            """
            SELECT f.id, f.name, f.created_at,
                   (SELECT COUNT(*) FROM notes n WHERE n.folder_id = f.id) AS note_count
            FROM folders f
            ORDER BY f.created_at ASC
            """
        ).fetchall()
        return [dict(r) for r in rows]


def get_folder(db_path: str | Path, folder_id: int) -> dict[str, Any] | None:
    with connect(db_path) as conn:
        row = conn.execute("SELECT id, name FROM folders WHERE id = ?", (folder_id,)).fetchone()
        return dict(row) if row else None


def create_folder(db_path: str | Path, name: str) -> dict[str, Any]:
    clean = (name or "").strip()
    if not clean:
        raise ValueError("收藏夹名称不能为空")
    if len(clean) > 30:
        raise ValueError("收藏夹名称最长 30 字")
    with connect(db_path) as conn:
        try:
            cur = conn.execute(
                "INSERT INTO folders (name, created_at) VALUES (?, ?)", (clean, _now())
            )
        except Exception as exc:
            raise ValueError("收藏夹名称已存在") from exc
        return {"id": cur.lastrowid, "name": clean, "note_count": 0}


def rename_folder(db_path: str | Path, folder_id: int, name: str) -> dict[str, Any] | None:
    clean = (name or "").strip()
    if not clean:
        raise ValueError("收藏夹名称不能为空")
    if len(clean) > 30:
        raise ValueError("收藏夹名称最长 30 字")
    with connect(db_path) as conn:
        if not conn.execute("SELECT 1 FROM folders WHERE id = ?", (folder_id,)).fetchone():
            return None
        try:
            conn.execute("UPDATE folders SET name = ? WHERE id = ?", (clean, folder_id))
        except Exception as exc:
            raise ValueError("收藏夹名称已存在") from exc
        row = conn.execute(
            """
            SELECT f.id, f.name,
                   (SELECT COUNT(*) FROM notes n WHERE n.folder_id = f.id) AS note_count
            FROM folders f WHERE f.id = ?
            """,
            (folder_id,),
        ).fetchone()
        return dict(row)


def delete_folder(db_path: str | Path, folder_id: int) -> bool:
    with connect(db_path) as conn:
        cur = conn.execute("DELETE FROM folders WHERE id = ?", (folder_id,))
        # ON DELETE SET NULL 让归属笔记自动回“未分类”
        return cur.rowcount > 0
