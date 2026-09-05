"""采集服务测试：使用 httpx.MockTransport 模拟网络，不访问外网。"""
from __future__ import annotations

import asyncio

import httpx
import pytest

from app.services.collect import CollectError, collect_url


def _client_for(handler) -> httpx.AsyncClient:
    transport = httpx.MockTransport(handler)
    return httpx.AsyncClient(
        transport=transport,
        timeout=httpx.Timeout(5.0),
        follow_redirects=True,
    )


def test_collect_ok(sample_html):
    async def handler(request: httpx.Request) -> httpx.Response:
        assert request.headers["user-agent"]
        return httpx.Response(200, text=sample_html)

    result = asyncio.run(
        collect_url("https://example.com/article", http_client=_client_for(handler))
    )
    assert result["title"] == "注意力机制入门"
    assert result["source_url"] == "https://example.com/article"
    content = result["content"]
    # 保留 Markdown 结构：首行为标题，段落间有空行
    lines = [l for l in content.splitlines() if l.strip()]
    assert lines[0].lstrip().startswith("#")
    assert "\n\n" in content
    assert "注意力机制让模型在处理当前位置" in content
    # 应剔除导航/页脚噪音
    assert "导航链接" not in content
    assert "版权信息" not in content


def test_collect_bad_scheme():
    with pytest.raises(CollectError):
        asyncio.run(collect_url("ftp://example.com/a"))


def test_collect_http_error():
    async def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(404, text="not found")

    with pytest.raises(CollectError, match="404"):
        asyncio.run(collect_url("https://example.com/missing", http_client=_client_for(handler)))


def test_collect_empty_body():
    async def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, text="<html></html>")

    with pytest.raises(CollectError):
        asyncio.run(collect_url("https://example.com/empty", http_client=_client_for(handler)))
