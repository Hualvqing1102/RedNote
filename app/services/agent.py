"""Agent 服务：摘要 / 追问。

所有「智能」都通过 providers.LLMProvider 接口调用；server 层按本地设置
（app/settings.py）用 providers.build_provider 实例化后传入。

- 未配置真实模型时用 MockProvider（本地规则、不联网），全流程可用。
- 配置了真实模型后：请求按模型协议发出；失败抛出 AgentError（502），
  不静默降级为本地规则，避免把"规则生成的文本"冒充成模型回答。
"""
from __future__ import annotations

import json
from typing import Any

from app.services.providers import LLMProvider, MockProvider, ProviderError

SYSTEM_SUMMARIZE = (
    "你是一个学习笔记助手。根据用户提供的文章标题与正文，"
    "提炼一段中文摘要（150 字以内）和 3-5 个要点。"
    "必须只输出 JSON，不要输出任何其他文字，格式："
    '{"summary": "...", "points": ["..."]}'
)

SYSTEM_ASK = (
    "你是学习助手。只根据用户提供的这篇笔记内容回答他的问题，"
    "忠实于笔记，不编造笔记中没有的信息。回答使用中文。"
)


class AgentError(Exception):
    """Agent 调用失败的领域异常（消息可直接展示给用户）。"""


# ---------------------------------------------------------------- 摘要


async def summarize(
    title: str,
    content: str,
    provider: LLMProvider | None = None,
) -> dict[str, Any]:
    content = (content or "").strip()
    provider = provider or MockProvider()
    is_mock = isinstance(provider, MockProvider)
    prompt = f"标题：{title or '未命名'}\n正文：{content[:12000]}"
    try:
        out = await provider.complete(SYSTEM_SUMMARIZE, prompt)
        data = _parse_json(out)
        if not isinstance(data, dict):
            raise ValueError("模型输出不是对象")
        summary = str(data.get("summary") or "").strip()
        points = [str(p).strip() for p in (data.get("points") or []) if str(p).strip()]
        if not summary and not points:
            raise ValueError("模型输出为空")
        return {
            "title": title or "未命名",
            "summary": summary[:500],
            "points": points[:5],
        }
    except ProviderError as exc:
        # 统一转换为 AgentError，让 API 层只需捕获这一种领域异常
        raise AgentError(str(exc)) from exc
    except Exception as exc:
        if is_mock:
            # MockProvider 理论不会失败；兜底保证接口总有输出
            base = _mock_fallback_summary(content)
            return {"title": title or "未命名", **base}
        raise AgentError(f"模型返回内容无法解析：{exc}") from exc


# ---------------------------------------------------------------- 追问


async def ask(
    note: dict[str, Any],
    question: str,
    provider: LLMProvider | None = None,
) -> str:
    provider = provider or MockProvider()
    is_mock = isinstance(provider, MockProvider)
    prompt = (
        f"笔记标题：{note.get('title', '')}\n"
        f"笔记内容：{note.get('content', '')[:12000]}\n"
        f"问题：{question}"
    )
    try:
        answer = await provider.complete(SYSTEM_ASK, prompt)
        return (answer or "").strip() or "（没有回答）"
    except ProviderError as exc:
        raise AgentError(str(exc)) from exc
    except Exception as exc:
        if is_mock:
            return _mock_fallback_ask(note, question)
        raise AgentError(f"模型返回内容无法解析：{exc}") from exc


# ---------------------------------------------------------------- Mock 兜底


def _mock_fallback_summary(content: str) -> dict[str, Any]:
    from app.services.providers import _mock_summary

    return _mock_summary(content)


def _mock_fallback_ask(note: dict[str, Any], question: str) -> str:
    import re

    content = note.get("content") or ""
    paragraph = next((p.strip() for p in re.split(r"\n\s*\n", content) if p.strip()), "")
    if len(paragraph) > 200:
        paragraph = paragraph[:200].rstrip() + "…"
    return (
        f"根据这篇笔记，相关内容是：{paragraph}\n"
        f"（关于「{question}」的完整回答将在接入真实模型后提供）"
    )


def _parse_json(text: str) -> Any:
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass
    start = text.find("{")
    end = text.rfind("}")
    if start != -1 and end != -1 and end > start:
        try:
            return json.loads(text[start : end + 1])
        except json.JSONDecodeError:
            pass
    raise ValueError("无法解析模型输出")
