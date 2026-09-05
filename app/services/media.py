"""图片资源(media)数据层。

采集时把网页插图下载后以 BLOB 存入 SQLite(本地优先、随笔记一起备份/导出)，
内容 Markdown 中以 /media/{token} 引用；token = sha1(原图 URL) 的十六进制串。
"""
from __future__ import annotations

import hashlib
import re
import sqlite3
import time
from pathlib import Path
from typing import Any

from app.db import connect

# 内容里引用图片的写法：![alt](/media/{token})
MEDIA_REF_RE = re.compile(r"!\[[^\]]*\]\(/media/([0-9a-f]{40})\)")


def token_for(url: str) -> str:
    return hashlib.sha1(url.encode("utf-8")).hexdigest()


def collect_images(content: str) -> list[str]:
    """从 Markdown 正文里找出引用了哪些本地图片 token。"""
    return MEDIA_REF_RE.findall(content)


def insert(
    db_path: str | Path,
    *,
    url: str,
    mime: str,
    alt: str,
    data: bytes,
    note_id: int | None = None,
) -> str:
    """保存一张图(按 URL 去重)，返回 token。"""
    token = token_for(url)
    now = int(time.time())
    with connect(db_path) as conn:
        conn.execute(
            """
            INSERT INTO media (token, note_id, url, mime, alt, data, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (token, note_id, url, mime, alt, sqlite3.Binary(data), now),
        )
    return token


def get(db_path: str | Path, token: str) -> dict[str, Any] | None:
    with connect(db_path) as conn:
        row = conn.execute(
            "SELECT id, token, note_id, url, mime, alt, data FROM media WHERE token = ?",
            (token,),
        ).fetchone()
        if not row:
            return None
        return {
            "token": row["token"],
            "mime": row["mime"],
            "alt": row["alt"],
            "data": bytes(row["data"]),
        }


def bind_note(db_path: str | Path, note_id: int, content: str) -> int:
    """把正文中引用的图片归属到指定笔记，返回绑定条数。"""
    with connect(db_path) as conn:
        return bind_note_conn(conn, note_id, content)


def bind_note_conn(conn: Any, note_id: int, content: str) -> int:
    """在同一连接(事务)内绑定图片，避免跨连接的写锁冲突。"""
    tokens = collect_images(content)
    if not tokens:
        return 0
    cur = conn.execute(
        "UPDATE media SET note_id = ? WHERE note_id IS NULL AND token IN ({})".format(
            ",".join("?" for _ in tokens)
        ),
        (note_id, *tokens),
    )
    return cur.rowcount


def replace_with_data_uris(db_path: str | Path, content: str) -> str:
    """把正文里的 /media/{token} 替换成 base64 data URI(供导出 Markdown 单文件)。"""
    def _replace(match: "re.Match[str]") -> str:
        media = get(db_path, match.group(1))
        if not media:
            return match.group(0)
        import base64

        data = base64.b64encode(media["data"]).decode("ascii")
        return f"![{media['alt']}](data:{media['mime']};base64,{data})"

    return MEDIA_REF_RE.sub(_replace, content)
