"""LLM Provider 层：统一接口 + 可插拔实现。

- MockProvider：本地规则，不联网（未配置 Key / 默认 Provider 时使用）。
- OpenAICompatibleProvider：任意 OpenAI 兼容端点（DeepSeek 云、Ollama、
  LM Studio、本地部署模型），走 POST {base_url}/chat/completions。
- ClaudeProvider：Anthropic Messages API。
- build_provider(cfg)：按 app/settings.py 读取的配置实例化对应 Provider。

所有真实 Provider 出错时抛 ProviderError（含对用户友好、不泄露 Key 的信息），
由上层决定如何降级或提示，避免"静默用本地规则冒充 AI 输出"。
"""
from __future__ import annotations

import json
import re
from typing import Any, Protocol

import httpx

# 模型返回慢（长文总结），超时放宽到 60s
REQUEST_TIMEOUT = httpx.Timeout(60.0, connect=10.0)
ANTHROPIC_VERSION = "2023-06-01"


class ProviderError(Exception):
    """Provider 调用失败的领域异常（消息可直接展示给用户）。"""


class LLMProvider(Protocol):
    async def complete(self, system: str, prompt: str) -> str: ...


# ---------------------------------------------------------------- Mock


class MockProvider:
    """M1 起就存在的本地规则 Provider：不联网，输出确定，便于无 Key 时体验全流程。"""

    async def complete(self, system: str, prompt: str) -> str:
        if "必须只输出 JSON" in system:
            body = prompt.split("正文：", 1)[-1]
            return json.dumps(_mock_summary(body), ensure_ascii=False)
        question = prompt.split("问题：", 1)[-1].strip() or "这个问题"
        return (
            f"（本地模拟回答）关于「{question}」，"
            "在设置中配置真实模型后，我会基于这篇笔记给出完整回答。"
        )


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


# ---------------------------------------------------------------- 真实 Provider 基类


class _HttpMixin:
    """管理可选的注入客户端；未注入时自建并在结束后关闭。"""

    def __init__(self, http_client: httpx.AsyncClient | None = None) -> None:
        self._client = http_client
        self._owns_client = http_client is None

    def _get_client(self) -> httpx.AsyncClient:
        if self._client is None:
            self._client = httpx.AsyncClient(timeout=REQUEST_TIMEOUT, follow_redirects=True)
        return self._client

    async def aclose(self) -> None:
        if self._owns_client and self._client is not None:
            await self._client.aclose()
            self._client = None


# ---------------------------------------------------------------- OpenAI 兼容端点


class OpenAICompatibleProvider(_HttpMixin):
    """覆盖 DeepSeek 云、Ollama、LM Studio 及任意本地 OpenAI 兼容服务。"""

    def __init__(
        self,
        base_url: str,
        model: str,
        api_key: str,
        http_client: httpx.AsyncClient | None = None,
    ) -> None:
        super().__init__(http_client)
        self.base_url = base_url.rstrip("/")
        self.model = model
        self.api_key = api_key

    async def complete(self, system: str, prompt: str) -> str:
        headers = {"Content-Type": "application/json"}
        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"
        body = {
            "model": self.model,
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": prompt},
            ],
            "temperature": 0.2,
        }
        client = self._get_client()
        try:
            resp = await client.post(f"{self.base_url}/chat/completions", json=body, headers=headers)
        except httpx.HTTPError as exc:
            raise ProviderError(f"无法连接模型服务：{exc.__class__.__name__}") from exc
        if resp.status_code != 200:
            raise ProviderError(_extract_http_error(resp, default=f"模型服务返回 {resp.status_code}"))
        data = _as_json(resp)
        try:
            return str(data["choices"][0]["message"]["content"])
        except (KeyError, IndexError, TypeError) as exc:
            raise ProviderError("模型返回格式不符合 OpenAI 兼容协议") from exc


# ---------------------------------------------------------------- Claude


class ClaudeProvider(_HttpMixin):
    """Anthropic Messages API。"""

    def __init__(
        self,
        model: str,
        api_key: str,
        http_client: httpx.AsyncClient | None = None,
        base_url: str = "https://api.anthropic.com",
    ) -> None:
        super().__init__(http_client)
        self.base_url = base_url.rstrip("/")
        self.model = model
        self.api_key = api_key

    async def complete(self, system: str, prompt: str) -> str:
        headers = {
            "Content-Type": "application/json",
            "x-api-key": self.api_key,
            "anthropic-version": ANTHROPIC_VERSION,
        }
        body = {
            "model": self.model,
            "max_tokens": 1024,
            "system": system,
            "messages": [{"role": "user", "content": prompt}],
        }
        client = self._get_client()
        try:
            resp = await client.post(f"{self.base_url}/v1/messages", json=body, headers=headers)
        except httpx.HTTPError as exc:
            raise ProviderError(f"无法连接模型服务：{exc.__class__.__name__}") from exc
        if resp.status_code != 200:
            raise ProviderError(_extract_http_error(resp, default=f"模型服务返回 {resp.status_code}"))
        data = _as_json(resp)
        try:
            return "".join(block["text"] for block in data["content"] if block.get("type") == "text")
        except (KeyError, TypeError) as exc:
            raise ProviderError("模型返回格式不符合 Anthropic Messages 协议") from exc


# ---------------------------------------------------------------- 工厂


def build_provider(cfg: dict[str, Any]) -> LLMProvider:
    """按 settings 配置实例化 Provider。

    规则：provider=mock，或选了真实 Provider 但未填 Key 时，都返回 MockProvider，
    保证应用在任何配置下都能运行。
    """
    provider = cfg.get("provider", "mock")
    if provider == "mock":
        return MockProvider()
    group = cfg.get(provider) or {}
    if not str(group.get("api_key") or "").strip():
        return MockProvider()
    if provider == "openai":
        return OpenAICompatibleProvider(
            base_url=str(group["base_url"]),
            model=str(group["model"]),
            api_key=str(group["api_key"]),
        )
    if provider == "claude":
        return ClaudeProvider(model=str(group["model"]), api_key=str(group["api_key"]))
    return MockProvider()


def configured_provider_name(cfg: dict[str, Any]) -> str:
    """当前生效的真实 Provider 名（未配置 Key 时为 mock）。"""
    info = {"provider": cfg.get("provider", "mock")}
    if info["provider"] == "mock":
        return "mock"
    group = cfg.get(info["provider"]) or {}
    if not str(group.get("api_key") or "").strip():
        return "mock"
    return info["provider"]


def _extract_http_error(resp: httpx.Response, default: str) -> str:
    """从常见错误体里摘出可展示的信息（不打印 Key）。"""
    try:
        data = resp.json()
    except ValueError:
        return default
    message = data.get("error") or data.get("message")
    if isinstance(message, dict):
        message = message.get("message") or message.get("type")
    if isinstance(message, str) and message.strip():
        return message.strip()[:200]
    return default


def _as_json(resp: httpx.Response) -> Any:
    try:
        return resp.json()
    except ValueError as exc:
        raise ProviderError("模型服务返回了非 JSON 内容") from exc
