"""SQLite 连接与建表。

数据模型(MVP 现版)：
- notes: 笔记主表(正文 Markdown + 摘要/要点/注释 JSON + 来源 + 时间戳 + 所属收藏夹)
- folders: 用户自建收藏夹(替代标签)；删除收藏夹后其笔记 folder_id 置空
标签体系(tags / note_tags)已随 v2 彻底移除。
"""
from __future__ import annotations

import sqlite3
from pathlib import Path

SCHEMA = """
CREATE TABLE IF NOT EXISTS folders (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT NOT NULL UNIQUE,
    created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS notes (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    title           TEXT NOT NULL,
    summary         TEXT NOT NULL DEFAULT '',
    content         TEXT NOT NULL DEFAULT '',
    points          TEXT NOT NULL DEFAULT '[]',
    comments        TEXT NOT NULL DEFAULT '[]',
    source_url      TEXT NOT NULL DEFAULT '',
    source_snapshot TEXT NOT NULL DEFAULT '',
    folder_id       INTEGER REFERENCES folders(id) ON DELETE SET NULL,
    created_at      INTEGER NOT NULL,
    updated_at      INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS events (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    title      TEXT NOT NULL,
    kind       TEXT NOT NULL DEFAULT 'todo',      -- 'schedule' 日程 | 'todo' 待办
    color      TEXT NOT NULL DEFAULT 'green',     -- green/blue/yellow/pink/purple
    recur      TEXT NOT NULL DEFAULT 'none',      -- 'none' 仅一次 | 'weekly' 每周重复
    start_ts   INTEGER NOT NULL,                  -- 秒级时间戳(本地)
    end_ts     INTEGER,                           -- 日程结束(可为空)
    all_day    INTEGER NOT NULL DEFAULT 0,
    done       INTEGER NOT NULL DEFAULT 0,
    note_id    INTEGER REFERENCES notes(id) ON DELETE SET NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
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
        # ---- 老库迁移(全部幂等) ----
        # 1) notes 补 comments 列
        cols = {row[1] for row in conn.execute("PRAGMA table_info(notes)").fetchall()}
        if "comments" not in cols:
            conn.execute("ALTER TABLE notes ADD COLUMN comments TEXT NOT NULL DEFAULT '[]'")
        # 2) notes 补 folder_id 列并外链 folders
        if "folder_id" not in cols:
            conn.execute(
                "ALTER TABLE notes ADD COLUMN folder_id INTEGER "
                "REFERENCES folders(id) ON DELETE SET NULL"
            )
        # 3) 彻底移除标签体系(含历史数据)
        conn.execute("DROP TABLE IF EXISTS note_tags")
        conn.execute("DROP TABLE IF EXISTS tags")
        # 4) events 老表补 color 列
        if conn.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='events'").fetchone():
            ev_cols = {row[1] for row in conn.execute("PRAGMA table_info(events)").fetchall()}
            if "color" not in ev_cols:
                conn.execute("ALTER TABLE events ADD COLUMN color TEXT NOT NULL DEFAULT 'green'")
            if "recur" not in ev_cols:
                conn.execute("ALTER TABLE events ADD COLUMN recur TEXT NOT NULL DEFAULT 'none'")
        # 移除早期测试版“图片抓取”遗留的 media 表（功能已下架）
        conn.execute("DROP TABLE IF EXISTS media")
