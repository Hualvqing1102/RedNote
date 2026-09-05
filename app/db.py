"""SQLite 连接与建表。"""
from __future__ import annotations

import sqlite3
from pathlib import Path

SCHEMA = """
CREATE TABLE IF NOT EXISTS notes (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    title           TEXT NOT NULL,
    summary         TEXT NOT NULL DEFAULT '',
    content         TEXT NOT NULL DEFAULT '',
    points          TEXT NOT NULL DEFAULT '[]',
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
"""


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
