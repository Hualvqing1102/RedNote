"""Provider 层测试：用 MockTransport 验证真实请求格式与解析，不访问外网。"""
from __future__ import annotations

import asyncio
import json

import httpx
import pytest

from app.services import providers
from app.services.providers import (
    ClaudeProvider,
    MockProvider,
    OpenAICompatibleProvider,
    ProviderError,
    build_provider,
    configured_provider_name,
)


def _client_for(handler) -> httpx.AsyncClient:
    return httpx.AsyncClient(transport=httpx.MockTransport(handler), timeout=httpx.Timeout(5.0))


def _run(coro):
    return asyncio.run(coro)


# ---------------------------------------------------------------- OpenAI 兼容


def test_openai_success_and_headers():
    seen: dict = {}

    async def handler(request: httpx.Request) -> httpx.Response:
        seen["auth"] = request.headers.get("authorization")
        seen["body"] = json.loads(request.content)
        assert request.url.path == "/v1/chat/completions"
        return httpx.Response(200, json={"choices": [{"message": {"content": "模型回答"}}]})

    p = OpenAICompatibleProvider(
        "https://api.deepseek.com/v1", "deepseek-chat", "sk-123", http_client=_client_for(handler)
    )
    out = _run(p.complete("系统提示", "用户正文"))
    assert out == "模型回答"
    assert seen["auth"] == "Bearer sk-123"
    assert seen["body"]["model"] == "deepseek-chat"
    assert seen["body"]["messages"][0]["role"] == "system"
    assert seen["body"]["messages"][1]["content"] == "用户正文"


def test_openai_no_key_still_allowed():
    async def handler(request: httpx.Request) -> httpx.Response:
        assert request.headers.get("authorization") is None
        return httpx.Response(200, json={"choices": [{"message": {"content": "ok"}}]})

    p = OpenAICompatibleProvider(
        "http://127.0.0.1:11434/v1", "qwen2.5", "", http_client=_client_for(handler)
    )
    assert _run(p.complete("s", "u")) == "ok"


def test_openai_http_error_message():
    async def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(401, json={"error": {"message": "Authentication Fails"}})

    p = OpenAICompatibleProvider("https://x/v1", "m", "bad", http_client=_client_for(handler))
    with pytest.raises(ProviderError, match="Authentication Fails"):
        _run(p.complete("s", "u"))


def test_openai_bad_structure():
    async def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"choices": []})

    p = OpenAICompatibleProvider("https://x/v1", "m", "k", http_client=_client_for(handler))
    with pytest.raises(ProviderError, match="协议"):
        _run(p.complete("s", "u"))


# ---------------------------------------------------------------- Claude


def test_claude_success_and_headers():
    seen: dict = {}

    async def handler(request: httpx.Request) -> httpx.Response:
        seen["x-api-key"] = request.headers.get("x-api-key")
        seen["version"] = request.headers.get("anthropic-version")
        seen["body"] = json.loads(request.content)
        assert request.url.path == "/v1/messages"
        return httpx.Response(200, json={"content": [{"type": "text", "text": "克劳德回答"}]})

    p = ClaudeProvider("claude-3-5-sonnet-20241022", "sk-ant-x", http_client=_client_for(handler))
    out = _run(p.complete("系统", "提问"))
    assert out == "克劳德回答"
    assert seen["x-api-key"] == "sk-ant-x"
    assert seen["version"] == "2023-06-01"
    assert seen["body"]["model"] == "claude-3-5-sonnet-20241022"
    assert seen["body"]["system"] == "系统"
    assert seen["body"]["messages"][0]["content"] == "提问"
    assert seen["body"]["max_tokens"] > 0


def test_claude_error_message():
    async def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(429, json={"error": {"message": "Rate limited"}})

    p = ClaudeProvider("m", "k", http_client=_client_for(handler))
    with pytest.raises(ProviderError, match="Rate limited"):
        _run(p.complete("s", "u"))


def test_network_error_raises_friendly():
    async def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("boom", request=request)

    p = OpenAICompatibleProvider("https://x/v1", "m", "k", http_client=_client_for(handler))
    with pytest.raises(ProviderError, match="无法连接"):
        _run(p.complete("s", "u"))


# ---------------------------------------------------------------- 工厂


def test_build_mock_default():
    assert isinstance(build_provider({"provider": "mock"}), MockProvider)


def test_build_mock_when_key_missing():
    cfg = {"provider": "openai", "openai": {"base_url": "https://x", "model": "m", "api_key": ""}}
    assert isinstance(build_provider(cfg), MockProvider)
    assert configured_provider_name(cfg) == "mock"


def test_build_real_when_key_present():
    cfg = {"provider": "openai", "openai": {"base_url": "https://x", "model": "m", "api_key": "sk"}}
    assert isinstance(build_provider(cfg), OpenAICompatibleProvider)
    assert configured_provider_name(cfg) == "openai"

    claude = {"provider": "claude", "claude": {"model": "m", "api_key": "sk"}}
    assert isinstance(build_provider(claude), ClaudeProvider)


# ---------------------------------------------------------------- agent 层集成


def test_real_provider_failure_raises_not_silent_mock():
    """配置了真实模型但调用失败时，必须抛 AgentError，而不是静默退回本地规则。"""
    from app.services import agent

    async def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(500, json={"error": "server down"})

    real = OpenAICompatibleProvider("https://x/v1", "m", "sk", http_client=_client_for(handler))
    with pytest.raises(agent.AgentError, match="server down"):
        _run(agent.summarize("t", "正文很长。\n\n第二段。", provider=real))

    with pytest.raises(agent.AgentError, match="server down"):
        _run(agent.ask({"title": "t", "content": "正文"}, "问题", provider=real))


def test_mock_provider_never_fails():
    from app.services import agent

    out = _run(agent.summarize("标题", "注意力机制是 Transformer 的核心。\n\n深度学习模型大量使用它。"))
    assert out["summary"]
    assert "tags" not in out

    ans = _run(agent.ask({"title": "t", "content": "第一段。\n\n第二段。"}, "核心是什么"))
    assert "核心是什么" in ans
