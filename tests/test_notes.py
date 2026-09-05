"""笔记数据层测试(去标签版)：CRUD / 搜索 / 收藏夹归属。"""
from __future__ import annotations

import pytest

from app.services import folders as folders_svc
from app.services import notes as svc


def _sample() -> dict:
    return {
        "title": "Transformer 笔记",
        "summary": "关于注意力的总结",
        "content": "第一段内容。\n\n第二段内容。",
        "points": ["要点一", "要点二"],
        "source_url": "https://example.com/a",
        "source_snapshot": "原文快照",
    }


def test_create_and_get(db_path):
    note = svc.create_note(db_path, _sample())
    assert note["id"] > 0
    assert note["title"] == "Transformer 笔记"
    assert note["points"] == ["要点一", "要点二"]
    assert note["folder_id"] is None
    assert note["folder_name"] == ""

    got = svc.get_note(db_path, note["id"])
    assert got is not None
    assert got["source_url"] == "https://example.com/a"


def test_create_default_title(db_path):
    data = _sample()
    data["title"] = "   "
    note = svc.create_note(db_path, data)
    assert note["title"] == "无标题"


def test_list_search_and_folder_filter(db_path):
    a = svc.create_note(db_path, _sample())
    b = _sample()
    b["title"] = "SQL 优化"
    b["content"] = "关于索引与查询优化的内容。"

    folder = folders_svc.create_folder(db_path, "数据库类")
    b["folder_id"] = folder["id"]
    svc.create_note(db_path, b)

    assert len(svc.list_notes(db_path)) == 2
    assert [n["id"] for n in svc.list_notes(db_path, q="Transformer")] == [a["id"]]
    in_folder = svc.list_notes(db_path, folder=folder["id"])
    assert len(in_folder) == 1
    assert in_folder[0]["title"] == "SQL 优化"
    assert in_folder[0]["folder_name"] == "数据库类"


def test_update_and_move_folder(db_path):
    folder_a = folders_svc.create_folder(db_path, "A")
    folder_b = folders_svc.create_folder(db_path, "B")
    note = svc.create_note(db_path, {**_sample(), "folder_id": folder_a["id"]})

    updated = svc.update_note(db_path, note["id"], {"title": "新标题"})
    assert updated["title"] == "新标题"
    assert updated["folder_id"] == folder_a["id"]

    moved = svc.update_note(db_path, note["id"], {"folder_id": folder_b["id"]})
    assert moved["folder_id"] == folder_b["id"]
    assert moved["folder_name"] == "B"

    cleared = svc.update_note(db_path, note["id"], {"folder_id": None})
    assert cleared["folder_id"] is None


def test_update_requires_field(db_path):
    note = svc.create_note(db_path, _sample())
    with pytest.raises(ValueError):
        svc.update_note(db_path, note["id"], {})


def test_delete(db_path):
    note = svc.create_note(db_path, _sample())
    assert svc.delete_note(db_path, note["id"]) is True
    assert svc.get_note(db_path, note["id"]) is None


def test_delete_missing(db_path):
    assert svc.delete_note(db_path, 99999) is False
