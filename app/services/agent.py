"""Agent 服务：摘要 / 追问。

设计：所有「智能」都通过统一的 LLMProvider 接口调用。
M1 阶段默认使用 MockProvider（本地规则，无需联网、无需密钥）；
M2 将加入 ClaudeProvider、OpenAICompatibleProvider（可接本地 DeepSeek/Ollama），
届时通过 settings 选择 Provider，其余代码不变。
"""
from __future__ import annotations

import json
import re
from typing import Any, Protocol

SYSTEM_SUMMARIZE = (
    "你是一个学习笔记助手。根据用户提供的文章标题与正文，"
    "提炼一段中文摘要（150 字以内）、3-5 个要点、3-6 个简短标签。"
    "必须只输出 JSON，不要输出任何其他文字，格式："
    '{"summary": "...", "points": ["..."], "tags": ["..."]}'
)

SYSTEM_ASK = (
    "你是学习助手。只根据用户提供的这篇笔记内容回答他的问题，"
    "忠实于笔记，不编造笔记中没有的信息。回答使用中文。"
)


class LLMProvider(Protocol):
    async def complete(self, system: str, prompt: str) -> str: ...


class MockProvider:
    """M1 的本地规则 Provider：不联网，给个可用的、确定的输出。"""

    async def complete(self, system: str, prompt: str) -> str:
        if "必须只输出 JSON" in system:
            body = prompt.split("正文：", 1)[-1]
            mock = _mock_summary(body)
            return json.dumps(mock, ensure_ascii=False)
        question = prompt.split("问题：", 1)[-1].strip() or "这个问题"
        return (
            f"（M1 模拟回答）关于「{question}」，"
            "接入真实模型后，我会基于这篇笔记给出完整回答。"
        )


# ---------------------------------------------------------------- 摘要


async def summarize(
    title: str,
    content: str,
    provider: LLMProvider | None = None,
) -> dict[str, Any]:
    content = (content or "").strip()
    provider = provider or MockProvider()
    prompt = f"标题：{title or '未命名'}\n正文：{content[:12000]}"
    try:
        out = await provider.complete(SYSTEM_SUMMARIZE, prompt)
        data = _parse_json(out)
        if not isinstance(data, dict):
            raise ValueError("模型输出不是对象")
        summary = str(data.get("summary") or "").strip()
        points = [str(p).strip() for p in (data.get("points") or []) if str(p).strip()]
        tags = [str(t).strip() for t in (data.get("tags") or []) if str(t).strip()]
        if not summary and not points:
            raise ValueError("模型输出为空")
        return {
            "title": title or "未命名",
            "summary": summary[:500],
            "points": points[:5],
            "tags": tags[:8],
        }
    except Exception:
        base = _mock_summary(content)
        return {"title": title or "未命名", "summary": base["summary"], "points": base["points"], "tags": base["tags"]}


def _mock_summary(content: str) -> dict[str, Any]:
    paragraphs = [p.strip() for p in re.split(r"\n\s*\n", content) if p.strip()]
    if not paragraphs:
        return {"summary": "", "points": [], "tags": []}

    summary = paragraphs[0].replace("\n", " ")
    if len(summary) > 160:
        summary = summary[:160].rstrip() + "…"

    points: list[str] = []
    for para in paragraphs[:4]:
        one = para.replace("\n", " ")
        if len(one) > 70:
            one = one[:70].rstrip() + "…"
        points.append(one)

    tags: list[str] = []
    hay = content.lower()
    if any(k in hay for k in ["deep", "learning", "neural", "transformer", "attention", "model", "深度学习", "机器学习", "神经网络", "大模型", "人工智能"]):
        tags.append("AI")
    if any(k in hay for k in ["python", "java", "c++", "代码", "程序", "编程"]):
        tags.append("编程")
    if any(k in hay for k in ["sql", "database", "数据库", "index", "索引"]):
        tags.append("数据库")
    if any(k in hay for k in ["学习", "方法", "笔记", "记忆", "方法论"]):
        tags.append("学习方法")
    if not tags:
        tags.append("网页摘录")
    return {"summary": summary, "points": points[:5], "tags": tags[:4]}


def _parse_json(text: str) -> Any:
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass
    start = text.find("{")
    end = text.rfind("}")
    if start != -1 and end != -1 and end > start:
        return json.loads(text[start : end + 1])
    raise ValueError("无法解析模型输出")


# ---------------------------------------------------------------- 追问


async def ask(
    note: dict[str, Any],
    question: str,
    provider: LLMProvider | None = None,
) -> str:
    provider = provider or MockProvider()
    prompt = (
        f"笔记标题：{note.get('title', '')}\n"
        f"笔记内容：{note.get('content', '')[:12000]}\n"
        f"问题：{question}"
    )
    try:
        answer = await provider.complete(SYSTEM_ASK, prompt)
        return (answer or "").strip() or "（没有回答）"
    except Exception:
        return _fallback_ask(note, question)


def _fallback_ask(note: dict[str, Any], question: str) -> str:
    content = note.get("content") or ""
    paragraph = next((p.strip() for p in re.split(r"\n\s*\n", content) if p.strip()), "")
    if len(paragraph) > 200:
        paragraph = paragraph[:200].rstrip() + "…"
    return (
        f"根据这篇笔记，相关内容是：{paragraph}\n"
        f"（关于「{question}」的完整回答将在接入真实模型后提供）"
    )
