"""样式感知分级测试：采集时观察 DOM，把强样式/语义标题升级为 # 级标题。"""
from __future__ import annotations

import asyncio

import httpx

from app.services.collect import collect_url

PAGE = """<!DOCTYPE html><html lang="zh"><head><meta charset="utf-8"><title>分级页</title></head>
<body><nav>导航</nav>
<article>
<h1>文章大标题</h1>
<p>开头引导段。</p>
<p><strong>一、强化学习基础</strong></p>
<p>这是第一小节正文。</p>
<p style="font-weight:bold;font-size:20px">二、策略梯度方法</p>
<p>这是第二小节正文，句内有<b>关键</b>概念。</p>
<h2>三、总结</h2>
<p>结束段。</p>
</article>
<footer>页脚</footer></body></html>"""


def _run():
    async def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, headers={"content-type": "text/html"}, text=PAGE)

    client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    return asyncio.run(collect_url("https://example.com/page", http_client=client))


def test_promote_styled_headings():
    result = _run()
    lines = result["content"].splitlines()

    # 语义 h1/h2 → # 与 ##
    assert any(l.startswith("# 文章大标题") for l in lines)
    assert any(l.startswith("## 三、总结") for l in lines)
    # 独占 <strong> 段落 → ##
    assert any(l.startswith("## 一、强化学习基础") for l in lines)
    # 加粗+大字号段落 → ##
    assert any(l.startswith("## 二、策略梯度方法") for l in lines)

    # 句内 <b> 不算标题，仍是正文
    assert any("句内有**关键**概念" in l or "句内有<b>关键</b>" in l or "句内有" in l for l in lines if not l.startswith("#"))


def test_no_style_short_lines_untouched():
    """无结构信号(如公众号纯 p 排版)不应被误判成标题。"""
    page = """<!DOCTYPE html><html lang="zh"><head><meta charset="utf-8"><title>p</title></head>
<body><article>
<p>没有样式的普通段落。</p>
<p>通过复述操控注意力</p>
<p>后面的正文内容。</p>
</article></body></html>"""

    async def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, text=page)

    client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    result = asyncio.run(collect_url("https://example.com/p", http_client=client))
    lines = result["content"].splitlines()
    assert all(not l.lstrip().startswith("#") for l in lines)


def test_css_class_styled_title_promoted():
    """通过内嵌 <style> 的类规则设置大字号/加粗的段落也应升级为标题。"""
    page = """<!DOCTYPE html><html lang="zh"><head><meta charset="utf-8"><title>c</title>
<style>
  .article-title { font-size: 26px; font-weight: 700; }
  .section-title { font-size: 20px; font-weight: 600; }
  .body-text { font-size: 14px; }
</style></head>
<body><article>
<p class="article-title">CSS 大标题</p>
<p class="section-title">CSS 小节标题</p>
<p class="body-text">这是正文段落。</p>
<p>另一段正文。</p>
</article></body></html>"""

    async def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, text=page)

    client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    result = asyncio.run(collect_url("https://example.com/css", http_client=client))
    lines = result["content"].splitlines()
    assert any(l.startswith("# CSS 大标题") for l in lines)
    assert any(l.startswith("## CSS 小节标题") for l in lines)
    assert not any(l.lstrip().startswith("#") for l in lines if "正文段落" in l)
