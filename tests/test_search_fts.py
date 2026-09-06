"""FTS5 全文检索测试：相关度排序 / 中文命中 / 短词回退 / 与收藏夹过滤组合。"""
from __future__ import annotations

import sqlite3

import pytest

from app.db import fts_available
from app.services import folders as folders_svc
from app.services import notes as svc


def _fts_supported() -> bool:
    try:
        c = sqlite3.connect(":memory:")
        c.execute("CREATE VIRTUAL TABLE t USING fts5(x, tokenize='trigram')")
        c.close()
        return True
    except sqlite3.OperationalError:
        return False


pytestmark = pytest.mark.skipif(not _fts_supported(), reason="SQLite 未编译 FTS5")


def _note(title: str, content: str, summary: str = "", folder_id=None) -> dict:
    return {
        "title": title,
        "summary": summary,
        "content": content,
        "points": [],
        "source_url": "",
        "source_snapshot": "",
        "folder_id": folder_id,
    }


def test_index_created_and_query_by_relevance(db_path):
    assert fts_available(db_path)
    svc.create_note(db_path, _note("注意力机制笔记", "机器学习 基础概念 导论"))
    svc.create_note(db_path, _note("深度学习笔记", "注意力机制 让模型 关注序列中重要的位置 这是核心技术"))

    result = svc.list_notes(db_path, q="注意力机制")
    titles = [n["title"] for n in result]
    assert "深度学习笔记" in titles
    # 标题命中的排在最前(加权高于正文命中)
    assert titles[0] == "注意力机制笔记"


def test_search_updates_and_deletes(db_path):
    n = svc.create_note(db_path, _note("旧标题", "正文没有关键词"))
    assert svc.list_notes(db_path, q="傅里叶变换") == []

    svc.update_note(db_path, n["id"], {"content": "傅里叶变换 是 信号处理 的核心工具"})
    assert [x["id"] for x in svc.list_notes(db_path, q="傅里叶变换")] == [n["id"]]

    svc.delete_note(db_path, n["id"])
    assert svc.list_notes(db_path, q="傅里叶变换") == []


def test_short_query_falls_back_to_like(db_path):
    svc.create_note(db_path, _note("每周复习笔记", "单词 打卡 记录"))
    # “笔记”只有 2 个字，trigram 无法命中 → 回退 LIKE 仍能搜到
    found = svc.list_notes(db_path, q="笔记")
    assert [x["title"] for x in found] == ["每周复习笔记"]


def test_search_combined_with_folder(db_path):
    folder_a = folders_svc.create_folder(db_path, "英语")
    folder_b = folders_svc.create_folder(db_path, "数学")
    svc.create_note(db_path, _note("英语精读", "注意力机制 英语 词汇 精读", folder_id=folder_a["id"]))
    svc.create_note(db_path, _note("概率论", "注意力机制 数学 概率 分布", folder_id=folder_b["id"]))

    only_a = svc.list_notes(db_path, q="注意力机制", folder=folder_a["id"])
    assert [x["title"] for x in only_a] == ["英语精读"]


def test_search_api_orders_by_relevance(client):
    client.post("/api/notes", json=_note("RNN 介绍", "循环神经网络 基础 历史"))
    client.post("/api/notes", json=_note("Transformer 精读", "注意力机制 是 Transformer 的核心 详解"))

    resp = client.get("/api/notes", params={"q": "注意力机制"})
    assert resp.status_code == 200
    titles = [n["title"] for n in resp.json()]
    assert titles[0] == "Transformer 精读"
