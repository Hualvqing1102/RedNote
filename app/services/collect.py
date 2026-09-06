"""网页采集服务：抓取 URL，抽取正文（尽量还原网页排版为 Markdown）。

用 trafilatura 抽取主内容并输出 Markdown：保留标题层级(#/##)、段落空行、
无序/有序列表(含缩进嵌套)、GFM 表格、粗/斜体、行内代码与围栏代码块。
图片抓取已下架，留待下一阶段实现。
"""
from __future__ import annotations

import re
from typing import Any

import httpx
import trafilatura
from lxml import html as lxml_html

USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/126.0 Safari/537.36 RedNote/0.1"
)

_HEADING_TAGS = {"h1": 1, "h2": 2, "h3": 3, "h4": 4, "h5": 5, "h6": 6}
_TITLE_CLASS_RE = re.compile(r"(^|[\s_\-])(h[1-6]|title|heading|subhead|headline|section-title)", re.IGNORECASE)
_FONT_SIZE_RE = re.compile(r"font-size:\s*([\d.]+)px", re.IGNORECASE)
_FONT_WEIGHT_RE = re.compile(r"font-weight:\s*(bold|600|700|800|[6-9]00)", re.IGNORECASE)


def _norm(text: str) -> str:
    """去掉空白与行内 Markdown 记号，用于文本比对。"""
    return re.sub(r"[\s*_`#]", "", text or "")


def _full_text(el: Any) -> str:
    return "".join(el.itertext()).strip()


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


def _style_heading_candidates(html: str) -> dict[str, int]:
    """观察原始 DOM，收集“有结构信号”的标题文本 → 建议级别(1..6)。

    信号优先级从强到弱：
    1. 语义标签 h1~h6
    2. <strong>/<b> 独占整段的段落
    3. 内联样式 font-weight: bold / 700+ 或类名含 title/heading
    4. 内联 font-size 明显大于正文(>=17px 视为小节，>=24px 视为大节)
    无任何样式的普通短句不会被误判为标题。
    """
    candidates: dict[str, int] = {}

    def add(text: str, level: int) -> None:
        key = _norm(text)
        if key and len(key) <= 80 and key not in candidates:
            candidates[key] = level

    try:
        doc = lxml_html.fromstring(html)
    except Exception:
        return candidates

    for el in doc.iter():
        tag = el.tag if isinstance(el.tag, str) else ""
        low = tag.lower()
        if low in _HEADING_TAGS:
            add(_full_text(el), _HEADING_TAGS[low])

    # strong/b 独占段落、内联加粗或大字号段落
    for el in doc.iter("p", "div", "section", "li"):
        if not isinstance(el.tag, str):
            continue
        text = _full_text(el)
        if not text:
            continue
        style = (el.get("style") or "").lower()
        cls = el.get("class") or ""
        bold = False
        size = 0.0
        if _FONT_WEIGHT_RE.search(style):
            bold = True
        m = _FONT_SIZE_RE.search(style)
        if m:
            size = float(m.group(1))
        # 独占 strong/b：整段只有一个 <strong> 且文本一致 → 视为小标题
        strongs = el.xpath(".//strong | .//b")
        if not bold and not size and strongs:
            if any(_full_text(s) == text for s in strongs):
                add(text, 2)
                continue

        if bold or _TITLE_CLASS_RE.search(cls):
            add(text, 2)
        elif size >= 24:
            add(text, 1)
        elif size >= 17:
            add(text, 2)
    return candidates


def _promote_style_headings(markdown: str, html: str) -> str:
    """把正文里命中结构信号的段落行升级为 # 级标题。"""
    candidates = _style_heading_candidates(html)
    if not candidates:
        return markdown

    list_or_table = re.compile(r"^(\s*([-*+]|\d+[.)])\s|\s*\|)")
    out: list[str] = []
    for line in markdown.split("\n"):
        trimmed = line.strip()
        if (
            trimmed
            and not trimmed.startswith("#")
            and not trimmed.startswith("```")
            and not list_or_table.match(trimmed)
        ):
            key = _norm(trimmed)
            if key in candidates:
                level = candidates[key]
                # 去掉被转成的行内加粗记号，标题本身带字重
                clean_title = re.sub(r"^[*_`]+|[*_`]+$", "", trimmed).strip()
                out.append(f"{'#' * level} {clean_title}")
                continue
        out.append(line)
    return "\n".join(out)


# ---------------------------------------------------------------- 补漏 / 去噪


_NOISE_KEYWORDS = (
    "newsletter", "signup", "subscribe", "subscribe-", "share", "social",
    "related", "sidebar", "breadcrumb", "author", "cookie", "advert", "promo",
    "footer", "disclaimer", "toolbar", "utility-nav",
)
_MD_MARK_RE = re.compile(r"(\*\*|\*|`|_|^#+\s*)")
_LINK_RE = re.compile(r"!\[[^\]]*\]\([^)]*\)|\[([^\]]*)\]\([^)]*\)")


def _plain_norm(text: str) -> str:
    """正文块对比用归一化：去空白、Markdown 记号、链接，统一引号。"""
    text = _MD_MARK_RE.sub("", text or "")
    text = _LINK_RE.sub(lambda m: m.group(1) or "", text)
    for a, b in {"\u2018": "'", "\u2019": "'", "\u201c": '"', "\u201d": '"',
                 "\u2013": "-", "\u2014": "-", "\u200b": "", "\u00a0": " "}.items():
        text = text.replace(a, b)
    text = re.sub(r"\s+", "", text)
    return text.lower()


def _is_noise_el(el: Any) -> bool:
    node = el
    while node is not None and getattr(node, "tag", None) not in ("html", "body", None):
        cls = " ".join((node.get("class") or "").split()).lower()
        eid = (node.get("id") or "").lower()
        if any(k in cls or k in eid for k in _NOISE_KEYWORDS):
            return True
        node = node.getparent()
    return False


def _backfill_missing(markdown: str, html: str) -> str:
    """用原始 DOM 找回抽取器漏掉的正文块，并按原顺序插回；剔除噪音。

    思路：
    1. 把已抽正文按段切分(cleaned)，并在 DOM 里收集正文候选块(<p>/<li>/<pre>…)；
    2. 噪音区(订阅/分享/页脚等)的文本块从正文里剔除；
    3. 按 DOM 顺序双指针合并：漏块(不在正文中)插入其前后已有内容之间。
    """
    paragraphs = [p.strip() for p in re.split(r"\n\s*\n", markdown) if p.strip()]
    if not paragraphs:
        return markdown
    try:
        doc = lxml_html.fromstring(html)
    except Exception:
        return markdown
    root = (doc.xpath("//article | //main") or [doc])[0]

    # 1) 收集 DOM 噪音区文本并剔除正文中对应的段落
    noise_texts: set[str] = set()
    for el in root.iter("p", "li", "h1", "h2", "h3", "h4", "h5", "h6", "pre"):
        if isinstance(el.tag, str) and _is_noise_el(el):
            noise_texts.add(_plain_norm("".join(el.itertext())))
    cleaned = [p for p in paragraphs if _plain_norm(p) not in noise_texts]
    if not cleaned:
        cleaned = paragraphs

    # 2) DOM 顺序收集正文候选(排除噪音与过短块)
    dom_blocks: list[str] = []
    for el in root.iter("p", "li", "pre", "blockquote"):
        if not isinstance(el.tag, str) or _is_noise_el(el):
            continue
        text = "".join(el.itertext()).strip()
        if len(_plain_norm(text)) >= 35:
            dom_blocks.append(text)

    # 3) 双指针合并
    segments: list[str] = []
    clean_idx = 0
    used: set[str] = set()

    def norm_eq(a: str, b: str) -> bool:
        return _plain_norm(a) == _plain_norm(b)

    for dom_text in dom_blocks:
        n = _plain_norm(dom_text)
        if n in used:
            continue
        # 找到正文中与之相等的段落：从当前指针向后找
        found = None
        for i in range(clean_idx, len(cleaned)):
            if norm_eq(cleaned[i], dom_text):
                found = i
                break
        if found is not None:
            segments.extend(cleaned[clean_idx : found + 1])
            clean_idx = found + 1
            used.add(n)
        else:
            # 可能正文里已包含该句(例如被合并进别的段落)，跳过，避免重复
            already_covered = any(
                n in _plain_norm(c) and len(_plain_norm(c)) > len(n) for c in cleaned
            )
            if already_covered:
                continue
            # 真正漏掉的块：插入当前输出流(位于其前文之后)
            segments.append(dom_text)
            used.add(n)

    # 4) 收尾：把还没输出的正文段接上
    segments.extend(cleaned[clean_idx:])

    out = "\n\n".join(segments).strip()
    out = re.sub(r"[ \t]+\n", "\n", out)
    out = re.sub(r"\n{3,}", "\n\n", out)
    return out if out else markdown


async def collect_url(
    url: str,
    http_client: httpx.AsyncClient | None = None,
) -> dict[str, Any]:
    """抓取 URL 并返回 {title, content, source_url}。

    content 为 Markdown：尽量还原标题、段落、列表、表格、代码与粗斜体等排版。
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
            include_tables=True,
            include_formatting=True,
            favor_precision=True,
        )
        if not extracted or not extracted.strip():
            raise CollectError("未能从网页中抽取到正文，可能页面需要登录或由脚本动态渲染")

        # 补漏 + 去噪：用原始 DOM 对照已抽取正文，找回漏掉的段落/列表项，
        # 并按原文顺序插回；同时剔除订阅/分享等噪音块。
        content = _backfill_missing(extracted.strip(), html)
        # 观察原始 DOM：把带结构信号的段落行升级为对应级标题
        content = _promote_style_headings(content, html)

        return {
            "title": _extract_title(html, url),
            "content": content,
            "source_url": url,
        }
    finally:
        if http_client is None:
            await client.aclose()
