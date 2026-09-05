"""网页采集服务：抓取 URL，抽取正文(尽可能还原排版)并抓取本地插图。

流程：
1. httpx 抓取 HTML；
2. 把正文内合格的 <img> 逐个替换成哨兵 @@IMG{i}@@（保留其在文档里的相对位置）；
3. trafilatura 把主内容抽成 Markdown（保留标题/段落/列表/表格/粗斜体）；
4. 下载这些图片存入本地 SQLite(media 表)，再把哨兵替换成 ![alt](/media/{token})：
   - 存活在正文里的哨兵 → 图片插回原文对应位置；
   - 被抽取器丢弃的(如整块 figure) → 按原序集中追加到文末「原文插图」。
"""
from __future__ import annotations

import re
from pathlib import Path
from typing import Any
from urllib.parse import urljoin

import httpx
import trafilatura

from app.services import media as media_service

USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/126.0 Safari/537.36 RedNote/0.1"
)

MAX_IMAGES = 15  # 单页最多抓几张图
MAX_IMAGE_BYTES = 2_000_000  # 单张最大 2MB
IMAGE_EXTS = {"jpg", "jpeg", "png", "gif", "webp", "avif", "bmp"}
_IMG_TAG_RE = re.compile(r"<img\b[^>]*>", re.IGNORECASE)
_ATTR_RE = re.compile(r'\b(src|alt|data-src|data-original)\s*=\s*("([^"]*)"|\'([^\']*)\')', re.IGNORECASE)


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


def _img_attrs(tag: str) -> tuple[str, str]:
    """返回 (src, alt)，src 优先 data-src/data-original(懒加载图)。"""
    attrs: dict[str, str] = {}
    for m in _ATTR_RE.finditer(tag):
        attrs[m.group(1).lower()] = (m.group(3) or m.group(4) or "").strip()
    src = attrs.get("src") or attrs.get("data-src") or attrs.get("data-original") or ""
    alt = attrs.get("alt") or ""
    return src, alt


def _is_qualifying(src: str) -> bool:
    if not src.lower().startswith(("http://", "https://")):
        return False
    path = src.split("?")[0].lower()
    if path.endswith(".svg"):
        return False
    ext = path.rsplit(".", 1)[-1] if "." in path else ""
    return ext in IMAGE_EXTS


def _inject_sentinels(html: str, base_url: str) -> tuple[list[tuple[str, str]], str]:
    """把所有合格图片替换为哨兵，返回 ([(url, alt), ...], 注入后 html)。"""
    images: list[tuple[str, str]] = []

    def replace(match: "re.Match[str]") -> str:
        src, alt = _img_attrs(match.group(0))
        if not src:
            return ""
        absolute = urljoin(base_url, src)
        if not _is_qualifying(absolute) or len(images) >= MAX_IMAGES:
            return ""  # 不抓的图直接从正文中去掉
        index = len(images)
        images.append((absolute, alt))
        return f" @@IMG{index}@@ "

    injected = _IMG_TAG_RE.sub(replace, html)
    return images, injected


async def collect_url(
    url: str,
    http_client: httpx.AsyncClient | None = None,
    db_path: str | Path | None = None,
) -> dict[str, Any]:
    """抓取 URL 并返回 {title, content, source_url}。

    content 为 Markdown：保留标题层级、段落、列表(含嵌套)、表格、粗斜体；
    网页插图在 db_path 非空时下载到本地 media 表并尽量插回原位置。
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

        final_url = str(resp.url)
        images, injected = _inject_sentinels(html, final_url)

        extracted = trafilatura.extract(
            injected,
            output_format="markdown",
            include_comments=False,
            include_tables=True,
            favor_precision=True,
        )
        if not extracted or not extracted.strip():
            raise CollectError("未能从网页中抽取到正文，可能页面需要登录或由脚本动态渲染")
        markdown = extracted.strip()

        # 下载图片并替换哨兵
        content = await _embed_images(markdown, images, db_path, client)

        return {
            "title": _extract_title(html, url),
            "content": content,
            "source_url": url,
        }
    finally:
        if http_client is None:
            await client.aclose()


async def _embed_images(
    markdown: str,
    images: list[tuple[str, str]],
    db_path: str | Path | None,
    client: httpx.AsyncClient,
) -> str:
    """把哨兵替换为本地图片引用；失败的哨兵移除；被抽取器丢弃的图片集中放文末。"""
    if not images:
        return markdown

    sentinel_re = re.compile(r"@@IMG(\d+)@@")
    seen_in_flow = {int(i) for i in sentinel_re.findall(markdown)}

    refs: dict[int, str] = {}  # index -> 本地引用文案
    fallback: list[str] = []

    for index, (img_url, alt) in enumerate(images):
        if db_path is None:
            refs[index] = ""
            continue
        try:
            img_resp = await client.get(img_url)
        except httpx.HTTPError:
            refs[index] = ""
            continue
        if img_resp.status_code != 200:
            refs[index] = ""
            continue
        body = img_resp.content
        if not body or len(body) > MAX_IMAGE_BYTES:
            refs[index] = ""
            continue
        mime = img_resp.headers.get("content-type", "").split(";")[0].strip().lower()
        if not mime.startswith("image/") or mime == "image/svg+xml":
            ext = img_url.rsplit(".", 1)[-1].lower() if "." in img_url else ""
            if ext not in IMAGE_EXTS:
                refs[index] = ""
                continue
            mime = {"jpg": "image/jpeg", "jpeg": "image/jpeg"}.get(ext, f"image/{ext}")
        try:
            token = media_service.insert(
                db_path, url=img_url, mime=mime, alt=alt.strip()[:200], data=body
            )
        except Exception:
            refs[index] = ""
            continue
        alt_text = alt.strip() or f"图 {index + 1}"
        refs[index] = f"![{alt_text}](/media/{token})"
        if index not in seen_in_flow:
            fallback.append(refs[index])

    def replace(match: "re.Match[str]") -> str:
        index = int(match.group(1))
        return refs.get(index, "")

    content = sentinel_re.sub(replace, markdown)

    if fallback:
        content = (
            content.rstrip()
            + "\n\n## 原文插图\n\n"
            + "\n\n".join(fallback)
            + "\n"
        )
    # 清理可能残留的多余空白
    content = re.sub(r"[ \t]+\n", "\n", content)
    content = re.sub(r"\n{3,}", "\n\n", content)
    return content.strip() + ("\n" if content.strip() else "")
