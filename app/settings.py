"""本地设置存储：模型 Provider 配置。

按技术方案，配置保存在用户数据目录下的 settings.json（默认 data/settings.json，
可用环境变量 REDNOTE_DATA_DIR 覆盖）。API Key 只存本地、不进 Git（data/ 已被
.gitignore 忽略），通过 GET /api/settings 返回的视图永远不会包含密钥明文。
"""
from __future__ import annotations

import json
import os
import tempfile
from copy import deepcopy
from pathlib import Path
from typing import Any

from app import config

PROVIDERS = ("mock", "claude", "openai", "deepseek", "qwen")

# 需要 base_url+model 的真实 Provider（OpenAI 兼容协议）
OPENAI_LIKE = ("openai", "deepseek", "qwen")

# 仅在返回给前端的公开视图里展示的键
SECRET_KEYS = {"api_key"}

DEFAULTS: dict[str, Any] = {
    "provider": "mock",
    "claude": {
        "model": "claude-3-5-sonnet-20241022",
        "api_key": "",
    },
    "openai": {
        # 通用 OpenAI 兼容端点：Ollama、LM Studio、本地部署模型等
        "base_url": "http://127.0.0.1:11434/v1",
        "model": "qwen2.5",
        "api_key": "",
    },
    "deepseek": {
        # DeepSeek 官方 OpenAI 兼容接口
        "base_url": "https://api.deepseek.com",
        "model": "deepseek-chat",
        "api_key": "",
    },
    "qwen": {
        # 通义千问：阿里云百炼 DashScope 的 OpenAI 兼容模式
        "base_url": "https://dashscope.aliyuncs.com/compatible-mode/v1",
        "model": "qwen-plus",
        "api_key": "",
    },
}

_REQUIRED_URL_KEYS = {"base_url", "model"}


def settings_path() -> Path:
    return config.data_dir() / "settings.json"


def _deep_merge(base: dict[str, Any], patch: dict[str, Any]) -> dict[str, Any]:
    """合并嵌套字典；patch 中显式为 None/"" 的值用于清空。"""
    out = dict(base)
    for key, value in patch.items():
        if isinstance(value, dict) and isinstance(out.get(key), dict):
            out[key] = _deep_merge(out[key], value)
        elif value is None:
            out[key] = ""
        else:
            out[key] = value
    return out


def load(path: str | Path | None = None) -> dict[str, Any]:
    """读取设置；文件不存在或损坏时回退到默认值（不抛错）。"""
    target = Path(path) if path is not None else settings_path()
    try:
        raw = json.loads(target.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        raw = {}
    # 深拷贝 DEFAULTS，避免调用方修改返回值时污染模块级默认配置
    cfg = _deep_merge(deepcopy(DEFAULTS), raw)
    if cfg.get("provider") not in PROVIDERS:
        cfg["provider"] = "mock"
    return cfg


def save(cfg: dict[str, Any], path: str | Path | None = None) -> None:
    """原子写入 settings.json：先写临时文件再替换，避免写一半损坏配置。"""
    target = Path(path) if path is not None else settings_path()
    target.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp_name = tempfile.mkstemp(dir=str(target.parent), suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            json.dump(cfg, fh, ensure_ascii=False, indent=2)
        os.replace(tmp_name, target)
    finally:
        if os.path.exists(tmp_name):
            os.unlink(tmp_name)


def validate(cfg: dict[str, Any]) -> None:
    """校验配置合法性；不合法抛 ValueError（由 API 层转成 400）。"""
    provider = cfg.get("provider")
    if provider not in PROVIDERS:
        raise ValueError(f"不支持的 Provider：{provider!r}（可选 {', '.join(PROVIDERS)}）")
    if provider == "mock":
        return
    group = cfg.get(provider) or {}
    if provider in OPENAI_LIKE:
        base_url = str(group.get("base_url") or "").strip()
        model = str(group.get("model") or "").strip()
        if not base_url or not base_url.startswith(("http://", "https://")):
            raise ValueError("OpenAI 兼容端点的 base_url 必须是 http(s):// 开头的地址")
        if not model:
            raise ValueError("OpenAI 兼容端点需要填写模型名")
    elif provider == "claude":
        if not str(group.get("model") or "").strip():
            raise ValueError("Claude 需要填写模型名")


def apply_patch(patch: dict[str, Any], path: str | Path | None = None) -> dict[str, Any]:
    """把客户端提交的部分字段合并进当前设置并校验，返回合并后的完整配置。"""
    cfg = _deep_merge(load(path), patch)
    validate(cfg)
    return cfg


def public_view(cfg: dict[str, Any]) -> dict[str, Any]:
    """公开视图：剔除所有密钥，仅暴露「是否已配置 Key」。"""
    out: dict[str, Any] = {"provider": cfg.get("provider", "mock")}
    for group_name in PROVIDERS:
        if group_name == "mock":
            continue
        group = cfg.get(group_name) or {}
        view: dict[str, Any] = {"has_key": bool(str(group.get("api_key") or "").strip())}
        for key, value in group.items():
            if key not in SECRET_KEYS:
                view[key] = value
        out[group_name] = view
    return out


def active_provider(cfg: dict[str, Any]) -> dict[str, Any]:
    """判断当前生效的 Provider 是否真实可用（配置了 Key）。"""
    provider = cfg.get("provider", "mock")
    if provider == "mock":
        return {"provider": "mock", "available": True}
    group = cfg.get(provider) or {}
    available = bool(str(group.get("api_key") or "").strip())
    return {"provider": provider, "available": available}
