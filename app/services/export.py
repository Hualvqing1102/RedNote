"""导出服务：把笔记导出为 Markdown，或整体备份 SQLite 数据库。

呼应 MVP 方案的"防锁定"承诺：数据始终归用户，可导出 Markdown 与 SQLite 备份。
"""
from __future__ import annotations

import datetime
import time
from pathlib import Path
from typing import Any

SEPARATOR = "\n\n---\n\n"


def _fmt_date(epoch: int) -> str:
    return datetime.datetime.fromtimestamp(epoch).strftime("%Y-%m-%d %H:%M")


def note_to_markdown(note: dict[str, Any]) -> str:
    """把一条笔记渲染成 Markdown 文本（含摘要/要点/标签/来源元信息）。"""
    lines: list[str] = []
    lines.append(f"# {note.get('title') or '无标题'}")
    meta: list[str] = []
    if note.get("source_url"):
        meta.append(f"来源：{note['source_url']}")
    meta.append(f"创建于 {_fmt_date(note.get('created_at') or time.time())}")
    if note.get("updated_at"):
        meta.append(f"更新于 {_fmt_date(note['updated_at'])}")
    if note.get("tags"):
        meta.append("标签：" + "、".join(note["tags"]))
    if meta:
        lines.append("")
        lines.append("> " + " · ".join(meta))

    summary = (note.get("summary") or "").strip()
    if summary:
        lines += ["", "## 摘要", "", summary]

    points = note.get("points") or []
    if points:
        lines += ["", "## 要点", ""]
        lines += [f"- {p}" for p in points]

    content = (note.get("content") or "").strip()
    if content:
        lines += ["", "## 正文", "", content]

    comments = note.get("comments") or []
    if comments:
        lines += ["", "## 我的注释与相关链接", ""]
        for comment in comments:
            text = str(comment.get("text") or "").strip()
            if text:
                lines += [f"> {line}" for line in text.split("\n") if line.strip()]
            for link in comment.get("links") or []:
                title = str(link.get("title") or "").strip()
                url = str(link.get("url") or "").strip()
                if url:
                    lines.append(f"- {title or url}: {url}")
    return "\n".join(lines).strip() + "\n"


def notes_to_markdown(notes: list[dict[str, Any]]) -> str:
    """把多条笔记合并为一个 Markdown 文档（用于整库导出）。"""
    return SEPARATOR.join(note_to_markdown(n) for n in notes).strip() + "\n"


def sqlite_backup_bytes(db_path: str | Path) -> bytes:
    """读取数据库文件的字节（MVP：单文件、无并发写，直接读即可）。"""
    return Path(db_path).read_bytes()
