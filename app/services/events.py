"""日历数据层：日程(schedule)与待办(todo)的 CRUD。

存储秒级(本地)时间戳。kind 字段区分日程/待办；done 用于待办勾选。
"""
from __future__ import annotations

import time
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any

from app.db import connect

KINDS = {"schedule", "todo"}
COLORS = {"green", "blue", "yellow", "pink", "purple"}
RECURS = {"none", "weekly"}
PATCHABLE = {"title", "kind", "color", "recur", "start_ts", "end_ts", "all_day", "done", "note_id"}


def _now() -> int:
    return int(time.time())


def _clean(data: dict[str, Any], *, partial: bool) -> dict[str, Any]:
    out: dict[str, Any] = {}
    if not partial:
        title = str(data.get("title") or "").strip()
        if not title:
            raise ValueError("标题不能为空")
        out["title"] = title[:200]
        kind = data.get("kind", "todo")
        if kind not in KINDS:
            raise ValueError("类型只能是 schedule 或 todo")
        out["kind"] = kind
        start = data.get("start_ts")
        if not isinstance(start, int) or isinstance(start, bool):
            raise ValueError("开始时间必须为时间戳")
        out["start_ts"] = start
    else:
        if "title" in data:
            title = str(data.get("title") or "").strip()
            if not title:
                raise ValueError("标题不能为空")
            out["title"] = title[:200]
        if "kind" in data:
            kind = data.get("kind")
            if kind not in KINDS:
                raise ValueError("类型只能是 schedule 或 todo")
            out["kind"] = kind
        if "start_ts" in data:
            start = data.get("start_ts")
            if not isinstance(start, int) or isinstance(start, bool):
                raise ValueError("开始时间必须为时间戳")
            out["start_ts"] = start

    if "color" in data:
        color = data.get("color")
        if color not in COLORS:
            raise ValueError("颜色值不支持")
        out["color"] = color

    if "recur" in data:
        recur = str(data.get("recur") or "none")
        if recur not in RECURS:
            raise ValueError("重复频率只能是 none 或 weekly")
        out["recur"] = recur

    if "end_ts" in data:
        end = data.get("end_ts")
        out["end_ts"] = end if isinstance(end, int) and not isinstance(end, bool) else None
    if "all_day" in data:
        out["all_day"] = 1 if data.get("all_day") else 0
    if "done" in data:
        out["done"] = 1 if data.get("done") else 0
    if "note_id" in data:
        note_id = data.get("note_id")
        out["note_id"] = note_id if isinstance(note_id, int) and not isinstance(note_id, bool) else None

    start = out.get("start_ts", data.get("start_ts"))
    end = out.get("end_ts")
    if end is not None and start is not None and end < start:
        raise ValueError("结束时间不能早于开始时间")
    return out


def _row(row: Any) -> dict[str, Any]:
    item = dict(row)
    item["all_day"] = bool(item.get("all_day"))
    item["done"] = bool(item.get("done"))
    return item


def _expand_weekly(row: Any, start: int, end: int) -> list[dict[str, Any]]:
    """把每周重复的事件展开到 [start,end) 区间内出现的每一次。

    锚点日期取事件的 start_ts 当天；occurrence 分布在该星期几上，且不早于锚点日期。
    """
    base = int(row["start_ts"])
    base_dt = datetime.fromtimestamp(base)
    anchor_day = base_dt.replace(hour=0, minute=0, second=0, microsecond=0)
    weekday = base_dt.weekday()
    all_day = bool(row["all_day"])
    duration = (int(row["end_ts"]) - base) if row["end_ts"] is not None else None

    start_dt = datetime.fromtimestamp(start)
    end_dt = datetime.fromtimestamp(end)
    day = start_dt.replace(hour=0, minute=0, second=0, microsecond=0)

    out: list[dict[str, Any]] = []
    while day < end_dt:
        if day.weekday() == weekday and day >= anchor_day:
            occ = day if all_day else day.replace(
                hour=base_dt.hour, minute=base_dt.minute, second=base_dt.second
            )
            occ_ts = int(occ.timestamp())
            if occ_ts >= end:
                break
            end_ts = (occ_ts + duration) if duration is not None else None
            if end_ts is not None and end_ts <= start:
                day += timedelta(days=1)
                continue
            item = dict(row)
            item["start_ts"] = occ_ts
            item["end_ts"] = end_ts
            out.append(item)
        day += timedelta(days=1)
    return out


def list_events(db_path: str | Path, start: int | None = None, end: int | None = None) -> list[dict[str, Any]]:
    """按区间取事件：事件与窗口 [start,end) 有交集；每周重复的事件按发生次数展开。"""
    with connect(db_path) as conn:
        result: list[dict[str, Any]] = []
        # 仅一次的事件：与窗口有交集(无结束时间的待办只看 start)
        sql = "SELECT * FROM events WHERE recur = 'none' AND 1=1"
        params: list[Any] = []
        if start is not None:
            sql += " AND (end_ts IS NULL OR end_ts >= ?)"
            params.append(start)
        if end is not None:
            sql += " AND start_ts < ?"
            params.append(end)
        sql += " ORDER BY start_ts ASC, all_day DESC, id ASC"
        result.extend(_row(r) for r in conn.execute(sql, params).fetchall())

        # 每周重复的事件：展开到区间内
        weekly = conn.execute("SELECT * FROM events WHERE recur = 'weekly'").fetchall()
        if start is not None and end is not None:
            for r in weekly:
                result.extend(_expand_weekly(r, start, end))
        else:
            result.extend(_row(r) for r in weekly)

    result.sort(key=lambda e: (e["start_ts"], 0 if e["all_day"] else 1, e["id"]))
    return result


def get_event(db_path: str | Path, event_id: int) -> dict[str, Any] | None:
    with connect(db_path) as conn:
        row = conn.execute("SELECT * FROM events WHERE id = ?", (event_id,)).fetchone()
        return _row(row) if row else None


def create_event(db_path: str | Path, data: dict[str, Any]) -> dict[str, Any]:
    clean = _clean(data, partial=False)
    now = _now()
    with connect(db_path) as conn:
        cur = conn.execute(
            """
            INSERT INTO events (title, kind, color, recur, start_ts, end_ts, all_day, done, note_id, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                clean["title"], clean["kind"], clean.get("color", "green"), clean.get("recur", "none"),
                clean["start_ts"], clean.get("end_ts"), clean.get("all_day", 0), clean.get("done", 0),
                clean.get("note_id"), now, now,
            ),
        )
        return _row(conn.execute("SELECT * FROM events WHERE id = ?", (cur.lastrowid,)).fetchone())


def update_event(db_path: str | Path, event_id: int, patch: dict[str, Any]) -> dict[str, Any] | None:
    clean = _clean(patch, partial=True)
    if not clean:
        raise ValueError("没有需要更新的内容")
    with connect(db_path) as conn:
        if not conn.execute("SELECT 1 FROM events WHERE id = ?", (event_id,)).fetchone():
            return None
        sets = ", ".join(f"{k} = ?" for k in clean)
        conn.execute(
            f"UPDATE events SET {sets}, updated_at = ? WHERE id = ?",
            (*clean.values(), _now(), event_id),
        )
        row = conn.execute("SELECT * FROM events WHERE id = ?", (event_id,)).fetchone()
        return _row(row)


def delete_event(db_path: str | Path, event_id: int) -> bool:
    with connect(db_path) as conn:
        cur = conn.execute("DELETE FROM events WHERE id = ?", (event_id,))
        return cur.rowcount > 0
