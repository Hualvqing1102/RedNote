"""SQLite 连接与建表。"""
from __future__ import annotations

import sqlite3
import time
from pathlib import Path

SCHEMA = """
CREATE TABLE IF NOT EXISTS notes (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    title           TEXT NOT NULL,
    summary         TEXT NOT NULL DEFAULT '',
    content         TEXT NOT NULL DEFAULT '',
    points          TEXT NOT NULL DEFAULT '[]',
    comments        TEXT NOT NULL DEFAULT '[]',
    source_url      TEXT NOT NULL DEFAULT '',
    source_snapshot TEXT NOT NULL DEFAULT '',
    created_at      INTEGER NOT NULL,
    updated_at      INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS tags (
    id   INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS note_tags (
    note_id INTEGER NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
    tag_id  INTEGER NOT NULL REFERENCES tags(id)  ON DELETE CASCADE,
    PRIMARY KEY (note_id, tag_id)
);

CREATE TABLE IF NOT EXISTS media (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    token      TEXT NOT NULL UNIQUE,          -- sha1(原图 URL)，笔记内容里以 /media/{token} 引用
    note_id    INTEGER REFERENCES notes(id) ON DELETE CASCADE,  -- 未归属前为 NULL
    url        TEXT NOT NULL,                 -- 原网页图片地址
    mime       TEXT NOT NULL,
    alt        TEXT NOT NULL DEFAULT '',
    data       BLOB NOT NULL,
    created_at INTEGER NOT NULL
);
"""

# 注释卡片 JSON 结构：
# [{"id": "...", "text": "...", "links": [{"title": "...", "url": "..."}]}]


def connect(db_path: str | Path) -> sqlite3.Connection:
    conn = sqlite3.connect(str(db_path))
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def init_db(db_path: str | Path) -> None:
    path = Path(db_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    with connect(path) as conn:
        conn.executescript(SCHEMA)
        # 老库迁移：为已存在的 notes 表补充 comments 列（幂等）
        cols = {row[1] for row in conn.execute("PRAGMA table_info(notes)").fetchall()}
        if "comments" not in cols:
            conn.execute("ALTER TABLE notes ADD COLUMN comments TEXT NOT NULL DEFAULT '[]'")
        # 清理采集后一直没归属的孤儿图片（超过 24h）
        conn.execute(
            "DELETE FROM media WHERE note_id IS NULL AND created_at < ?",
            (int(time.time()) - 86400,),
        )
