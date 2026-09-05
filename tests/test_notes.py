"""笔记数据层 CRUD / 标签 / 搜索测试。"""
from __future__ import annotations

from app.services import notes as svc


def _sample() -> dict:
    return {
        "title": "Transformer 笔记",
        "summary": "关于注意力的总结",
        "content": "第一段内容。\n\n第二段内容。",
        "points": ["要点一", "要点二"],
        "source_url": "https://example.com/a",
        "source_snapshot": "原文快照",
        "tags": ["深度学习", "AI"],
    }


def test_create_and_get(db_path):
    note = svc.create_note(db_path, _sample())
    assert note["id"] > 0
    assert note["title"] == "Transformer 笔记"
    assert note["points"] == ["要点一", "要点二"]
    assert note["tags"] == ["AI", "深度学习"]  # 按名称排序

    got = svc.get_note(db_path, note["id"])
    assert got is not None
    assert got["source_url"] == "https://example.com/a"


def test_create_default_title(db_path):
    data = _sample()
    data["title"] = "   "
    note = svc.create_note(db_path, data)
    assert note["title"] == "无标题"


def test_list_and_filter(db_path):
    a = svc.create_note(db_path, _sample())
    b = _sample()
    b["title"] = "SQL 优化"
    b["tags"] = ["数据库"]
    b["content"] = "关于索引与查询优化的内容。"
    svc.create_note(db_path, b)

    # 全量：2 条
    assert len(svc.list_notes(db_path)) == 2
    # 关键词：命中 Transformer 那条
    assert [n["id"] for n in svc.list_notes(db_path, q="Transformer")] == [a["id"]]
    # 标签过滤
    tagged = svc.list_notes(db_path, tag="数据库")
    assert len(tagged) == 1
    assert tagged[0]["title"] == "SQL 优化"


def test_update(db_path):
    note = svc.create_note(db_path, _sample())
    updated = svc.update_note(db_path, note["id"], {"title": "新标题", "tags": ["编程"]})
    assert updated["title"] == "新标题"
    assert updated["tags"] == ["编程"]


def test_update_requires_field(db_path):
    note = svc.create_note(db_path, _sample())
    import pytest

    with pytest.raises(ValueError):
        svc.update_note(db_path, note["id"], {})


def test_delete(db_path):
    note = svc.create_note(db_path, _sample())
    assert svc.delete_note(db_path, note["id"]) is True
    assert svc.get_note(db_path, note["id"]) is None
    # 删除后标签关系应被清理
    assert svc.list_tags(db_path) == []


def test_delete_missing(db_path):
    assert svc.delete_note(db_path, 99999) is False
