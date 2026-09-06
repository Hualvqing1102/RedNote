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


# ---------------------------------------------------------------- CSS-lite 引擎

_SIZE_WORDS = {
    "xx-small": 9, "x-small": 10, "small": 13, "medium": 16,
    "large": 18, "x-large": 24, "xx-large": 32,
}
_WEIGHT_WORDS = {"normal": 400, "bold": 700, "bolder": 700, "lighter": 400}
_CSS_RULE_RE = re.compile(r"([^{}]+)\{([^{}]*)\}", re.DOTALL)
_PROP_RE = re.compile(r"(font-size|font-weight)\s*:\s*([^;!}]+)", re.IGNORECASE)


def _css_number(raw: str, parent_fs: float, root_fs: float) -> float | None:
    raw = (raw or "").strip().lower()
    word = _SIZE_WORDS.get(raw)
    if word is not None:
        return float(word)
    m = re.match(r"^([\d.]+)(px|rem|em|%)?$", raw)
    if not m:
        return None
    val = float(m.group(1))
    unit = m.group(2) or "px"
    if unit == "px":
        return val
    if unit == "rem":
        return val * root_fs
    if unit == "em":
        return val * parent_fs
    if unit == "%":
        return val * parent_fs / 100.0
    return None


def _weight_number(raw: str) -> int | None:
    raw = (raw or "").strip().lower()
    if raw in _WEIGHT_WORDS:
        return _WEIGHT_WORDS[raw]
    if re.fullmatch(r"[1-9]00", raw):
        return int(raw)
    return None


def _load_css_rules(doc: Any) -> list[dict[str, Any]]:
    """解析内嵌 <style> 中的简单选择器规则(tag / .class / #id / 组合)。"""
    rules: list[dict[str, Any]] = []
    for style_el in doc.iter("style"):
        text = style_el.text or ""
        for m in _CSS_RULE_RE.finditer(text):
            selector_raw, decl = m.group(1), m.group(2)
            for sel in selector_raw.split(","):
                sel = sel.strip()
                if not sel or any(ch in sel for ch in (">", "+", "~", "[", ":", "*")):
                    continue
                ids = re.findall(r"#([A-Za-z_][\w-]*)", sel)
                classes = set(re.findall(r"\.([A-Za-z_][\w-]*)", sel))
                tag_part = re.sub(r"#[A-Za-z_][\w-]*|\.([A-Za-z_][\w-]*)", "", sel).strip()
                props: dict[str, Any] = {}
                for pm in _PROP_RE.finditer(decl):
                    name = pm.group(1).lower()
                    raw = pm.group(2).strip()
                    if name == "font-size":
                        props["size_raw"] = raw
                    else:
                        props["weight_raw"] = raw
                if props:
                    rules.append(
                        {
                            "tag": tag_part.lower() if tag_part else None,
                            "eid": ids[0] if ids else None,
                            "classes": frozenset(classes),
                            "spec": (
                                1 if ids else 0,
                                len(classes),
                                1 if tag_part else 0,
                            ),
                            **props,
                        }
                    )
    return rules


def _inline_style_raw(el: Any) -> tuple[str | None, str | None]:
    style = (el.get("style") or "").lower()
    size = _FONT_SIZE_RE.search(style)
    weight = _FONT_WEIGHT_RE.search(style)
    return (size.group(0).split(":", 1)[1].strip() if size else None,
            weight.group(0).split(":", 1)[1].strip() if weight else None)


def _computed_styles(doc: Any, rules: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    """按文档序 DFS 计算每个元素的 font-size / font-weight(继承生效)。

    注意：lxml 每次访问元素会生成不同 Python 代理对象，因此用稳定的
    XPath 路径字符串作为键。
    """
    root_fs = 16.0
    memo: dict[str, dict[str, Any]] = {}

    def key(el: Any) -> str:
        return el.getroottree().getpath(el)

    def best_rule(el: Any, attr: str) -> dict[str, Any] | None:
        best = None
        for r in rules:
            if attr not in r or not _el_matches(el, r):
                continue
            if best is None or r["spec"] > best["spec"]:
                best = r
        return best

    def resolve(el: Any, parent: dict[str, Any] | None) -> None:
        inline_s, inline_w = _inline_style_raw(el)
        rule_s = best_rule(el, "size_raw")
        rule_w = best_rule(el, "weight_raw")
        raw_s = inline_s or (rule_s["size_raw"] if rule_s else None)
        raw_w = inline_w or (rule_w["weight_raw"] if rule_w else None)
        parent_fs = parent["fs"] if parent else root_fs
        fs = _css_number(raw_s, parent_fs, root_fs) if raw_s else parent_fs
        w = _weight_number(raw_w) if raw_w else (parent["w"] if parent else 400)
        style = {"fs": fs, "w": w}
        memo[key(el)] = style
        for child in el.iterchildren():
            if isinstance(child.tag, str):
                resolve(child, style)

    resolve(doc, None)
    return memo


def _el_matches(el: Any, rule: dict[str, Any]) -> bool:
    if rule["tag"] and (el.tag or "").lower() != rule["tag"]:
        return False
    if rule["eid"] and (el.get("id") or "") != rule["eid"]:
        return False
    if rule["classes"]:
        cls = set((el.get("class") or "").split())
        if not rule["classes"].issubset(cls):
            return False
    return True


def _style_heading_candidates(html: str) -> dict[str, int]:
    """观察原始 DOM，收集“有结构信号”的标题文本 → 建议级别(1..6)。

    信号优先级从强到弱：
    1. 语义标签 h1~h6
    2. <strong>/<b> 独占整段的段落
    3. 类名含 title/heading
    4. 计算后的字号/字重明显大于正文(含内嵌 <style> 类规则与内联样式)
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

    rules = _load_css_rules(doc)
    memo = _computed_styles(doc, rules)

    # 基准字号：body(或首段)的字体大小
    body = doc.find("body") if doc.tag == "html" else None
    base_fs = 16.0
    if body is not None:
        base_fs = memo.get(body.getroottree().getpath(body), {}).get("fs", 16.0)
    else:
        for el in doc.iter("p"):
            fs = memo.get(el.getroottree().getpath(el), {}).get("fs")
            if fs:
                base_fs = fs
                break

    for el in doc.iter():
        tag = el.tag if isinstance(el.tag, str) else ""
        low = tag.lower()
        if low in _HEADING_TAGS:
            add(_full_text(el), _HEADING_TAGS[low])

    for el in doc.iter("p", "div", "section", "li"):
        if not isinstance(el.tag, str):
            continue
        text = _full_text(el)
        if not text:
            continue
        style_obj = memo.get(el.getroottree().getpath(el), {"fs": base_fs, "w": 400})
        fs = style_obj.get("fs") or base_fs
        w = style_obj.get("w") or 400
        bold = w >= 600
        rel = fs / base_fs if base_fs else 1.0
        cls = el.get("class") or ""

        # 独占 strong/b：整段只有一个 <strong> 且文本一致 → 视为小标题
        strongs = el.xpath(".//strong | .//b")
        if not bold and rel < 1.3 and strongs:
            if any(_full_text(s) == text for s in strongs):
                add(text, 2)
                continue

        if bold and rel >= 1.5:
            add(text, 1)
        elif _TITLE_CLASS_RE.search(cls):
            add(text, 2)
        elif bold and rel >= 1.15:
            add(text, 2)
        elif rel >= 1.4:
            add(text, 1 if rel >= 2.0 else 2)
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


_HEADING_LEVEL = {"h1": 1, "h2": 2, "h3": 3, "h4": 4, "h5": 5, "h6": 6}


def _backfill_missing(markdown: str, html: str) -> str:
    """用原始 DOM 找回抽取器漏掉的正文块/标题，并按原顺序插回；剔除噪音。

    思路：
    1. 把已抽正文按段切分(cleaned)，并在 DOM 里收集候选块(<p>/<li>/<pre>/<h1..h6>…)；
    2. 噪音区(订阅/分享/页脚等)的文本块从正文里剔除；
    3. 按 DOM 顺序双指针合并：漏掉的块(含漏掉的语义标题)插回其前后内容之间。
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

    # 2) DOM 顺序收集候选(排除噪音与过短块)；记录是否为语义标题
    dom_blocks: list[tuple[str, int]] = []  # (text, level: 0=正文块, 1..6=标题)
    for el in root.iter("p", "li", "pre", "blockquote", "h1", "h2", "h3", "h4", "h5", "h6"):
        if not isinstance(el.tag, str) or _is_noise_el(el):
            continue
        text = "".join(el.itertext()).strip()
        if len(_plain_norm(text)) >= 35 or (el.tag.lower() in _HEADING_LEVEL and text):
            dom_blocks.append((text, _HEADING_LEVEL.get(el.tag.lower(), 0)))

    # 3) 双指针合并
    segments: list[str] = []
    clean_idx = 0
    used: set[str] = set()

    def norm_eq(a: str, b: str) -> bool:
        return _plain_norm(a) == _plain_norm(b)

    for dom_text, level in dom_blocks:
        n = _plain_norm(dom_text)
        if n in used:
            continue
        # 找到正文中与之相等的段落/标题：从当前指针向后找
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
            already_covered = any(
                n in _plain_norm(c) and len(_plain_norm(c)) > len(n) for c in cleaned
            )
            if already_covered:
                continue
            if level:
                segments.append(f"{'#' * level} {dom_text}")
            else:
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
