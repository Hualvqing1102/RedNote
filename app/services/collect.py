"""网页采集服务：抓取 URL，抽取正文。"""
from __future__ import annotations

import re
from typing import Any

import httpx
import trafilatura

USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/126.0 Safari/537.36 RedNote/0.1"
)


class CollectError(Exception):
    """采集失败的领域异常。"""


def _extract_title(html: str, fallback: str) -> str:
    meta = trafilatura.extract_metadata(html)
    if meta and meta.title:
        return meta.title.strip()
    match = re.search(r"<title[^>]*>(.*?)</title>", html, flags=re.IGNORECASE | re.DOTALL)
    if match:
        return re.sub(r"\s+", " ", match.group(1)).strip()
    return fallback


async def collect_url(
    url: str,
    http_client: httpx.AsyncClient | None = None,
) -> dict[str, Any]:
    """抓取 URL 并返回 {title, content, source_url}。

    content 为 Markdown 文本：保留原标题层级（# / ##）、段落（空行分段）
    与列表结构，便于人类阅读与二次编辑；图片暂不保存。
    """
    if not url.startswith(("http://", "https://")):
        raise CollectError("链接必须以 http:// 或 https:// 开头")

    client = http_client or httpx.AsyncClient(
        timeout=httpx.Timeout(20.0),
        headers={"User-Agent": USER_AGENT},
        follow_redirects=True,
    )
    try:
        try:
            resp = await client.get(url)
        except httpx.HTTPError as exc:
            raise CollectError(f"无法访问该网页：{exc.__class__.__name__}") from exc

        if resp.status_code != 200:
            raise CollectError(f"网页返回了异常状态码：{resp.status_code}")

        html = resp.text
        if not html or "<html" not in html.lower():
            raise CollectError("该地址似乎不是可解析的网页（可能返回了文件或空内容）")

        extracted = trafilatura.extract(
            html,
            output_format="markdown",
            include_comments=False,
            include_tables=False,
            favor_precision=True,
        )
        if not extracted or not extracted.strip():
            raise CollectError("未能从网页中抽取到正文，可能页面需要登录或由脚本动态渲染")

        return {
            "title": _extract_title(html, url),
            "content": extracted.strip(),
            "source_url": url,
        }
    finally:
        if http_client is None:
            await client.aclose()
