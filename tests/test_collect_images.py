"""采集图片测试：哨兵注入、本地入库、绑定笔记、/media 路由、导出内嵌 base64。"""
from __future__ import annotations

import asyncio
import re
import sqlite3

import httpx
import pytest

from app.services import media as media_service
from app.services.collect import collect_url

PNG_BYTES = b"\x89PNG\r\n\x1a\nfake-image-bytes-for-test"

PAGE_HTML = """<!DOCTYPE html><html lang="zh"><head><title>带图文章</title></head>
<body><nav>导航</nav>
<article>
<h1>带图文章标题</h1>
<p>开头段落，其中有一张行内图 @@P1@@ 和文字。</p>
<figure><img src="/img/b.png" alt="独立图B"><figcaption>图B</figcaption></figure>
<p>末尾段落。</p>
</article></body></html>"""


def _make_client() -> httpx.AsyncClient:
    async def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/article":
            # 先把站内相对图换成绝对 URL 再返回，模拟真实页面
            html = PAGE_HTML.replace("/img/b.png", "https://example.com/img/b.png").replace("@@P1@@", '<img src="/img/a.png" alt="行内图A">')
            return httpx.Response(200, headers={"content-type": "text/html"}, text=html)
        if request.url.path == "/img/a.png":
            return httpx.Response(200, headers={"content-type": "image/png"}, content=PNG_BYTES)
        if request.url.path == "/img/b.png":
            return httpx.Response(200, headers={"content-type": "image/png"}, content=PNG_BYTES)
        return httpx.Response(404)

    return httpx.AsyncClient(transport=httpx.MockTransport(handler), follow_redirects=True)


@pytest.fixture
def http_client():
    return _make_client()


def test_collect_downloads_images_and_places_inline(db_path, http_client):
    result = asyncio.run(collect_url("https://example.com/article", http_client=http_client, db_path=db_path))
    content = result["content"]
    refs = re.findall(r"!\[([^\]]*)\]\(/media/([0-9a-f]{40})\)", content)
    assert len(refs) == 2
    alts = [r[0] for r in refs]
    assert "行内图A" in alts and "独立图B" in alts

    # 行内图应出现在它那段文字附近(哨兵存活)；独立图因整块 figure 被抽取器丢弃 → 进入文末原文插图
    assert content.index("![行内图A]") < content.index("末尾段落")
    assert content.index("## 原文插图") < content.index("![独立图B]")

    # 图片已存入数据库
    with sqlite3.connect(str(db_path)) as conn:
        rows = conn.execute("SELECT url, mime, length(data), note_id FROM media ORDER BY url").fetchall()
    assert len(rows) == 2
    assert all(r[1] == "image/png" for r in rows)
    assert all(r[2] == len(PNG_BYTES) for r in rows)
    assert all(r[3] is None for r in rows)  # 尚未归属笔记


def test_create_note_binds_media_and_serves_via_route(client, db_path, http_client):
    result = asyncio.run(collect_url("https://example.com/article", http_client=http_client, db_path=db_path))
    resp = client.post(
        "/api/notes",
        json={
            "title": result["title"],
            "content": result["content"],
            "source_url": result["source_url"],
        },
    )
    assert resp.status_code == 201
    note_id = resp.json()["id"]

    with sqlite3.connect(str(db_path)) as conn:
        assert conn.execute("SELECT COUNT(*) FROM media WHERE note_id = ?", (note_id,)).fetchone()[0] == 2

    # 图片可通过 /media/{token} 取到
    token = re.search(r"/media/([0-9a-f]{40})", result["content"]).group(1)
    img = client.get(f"/media/{token}")
    assert img.status_code == 200
    assert img.headers["content-type"] == "image/png"
    assert img.content == PNG_BYTES
    assert client.get("/media/" + "0" * 40).status_code == 404


def test_export_embeds_images_as_base64(client, db_path, http_client):
    result = asyncio.run(collect_url("https://example.com/article", http_client=http_client, db_path=db_path))
    created = client.post("/api/notes", json={"title": "x", "content": result["content"]})
    note_id = created.json()["id"]

    md = client.get(f"/api/notes/{note_id}/export.md")
    assert md.status_code == 200
    assert "/media/" not in md.text
    data_uris = re.findall(r"data:image/png;base64,([A-Za-z0-9+/=]+)", md.text)
    assert len(data_uris) >= 1
    import base64

    assert base64.b64decode(data_uris[0]) == PNG_BYTES


def test_collect_without_images_unchanged(db_path, http_client):
    """无图页面照常出正文。"""
    async def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/plain":
            return httpx.Response(200, text="<html><head><title>无图</title></head><body><article><h1>标题</h1><p>纯文字段落。</p></article></body></html>")
        return httpx.Response(404)

    client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    result = asyncio.run(collect_url("https://example.com/plain", http_client=client, db_path=db_path))
    assert "![" not in result["content"]
    assert "纯文字段落。" in result["content"]


def test_broken_image_is_skipped(db_path, http_client):
    """图片下载失败时应跳过且不阻断采集。"""
    async def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/page":
            html = PAGE_HTML.replace("/img/b.png", "https://example.com/img/b.png").replace("@@P1@@", '<img src="/img/broken.jpg" alt="坏图">')
            return httpx.Response(200, text=html)
        if request.url.path == "/img/b.png":
            return httpx.Response(200, headers={"content-type": "image/png"}, content=PNG_BYTES)
        if request.url.path == "/img/broken.jpg":
            return httpx.Response(500)
        return httpx.Response(404)

    c = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    result = asyncio.run(collect_url("https://example.com/page", http_client=c, db_path=db_path))
    # 坏图无引用、无哨兵残留；好图仍在
    assert "@@IMG" not in result["content"]
    assert "/media/" in result["content"]
