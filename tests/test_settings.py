"""设置存储与 /api/settings 接口测试。"""
from __future__ import annotations

import json

import pytest

from app import settings as store


# ---------------------------------------------------------------- 存储层


def test_defaults_when_no_file(tmp_path):
    cfg = store.load(tmp_path / "nope.json")
    assert cfg["provider"] == "mock"
    assert store.public_view(cfg)["claude"]["has_key"] is False


def test_save_load_roundtrip(tmp_path):
    path = tmp_path / "settings.json"
    cfg = store.load(path)
    cfg["provider"] = "openai"
    cfg["openai"]["api_key"] = "sk-test-123"
    cfg["openai"]["base_url"] = "http://127.0.0.1:11434/v1"
    cfg["openai"]["model"] = "qwen2.5"
    store.save(cfg, path)

    loaded = store.load(path)
    assert loaded["provider"] == "openai"
    assert loaded["openai"]["api_key"] == "sk-test-123"
    assert loaded["openai"]["model"] == "qwen2.5"


def test_public_view_never_leaks_key(tmp_path):
    path = tmp_path / "settings.json"
    cfg = store.load(path)
    cfg["openai"]["api_key"] = "sk-super-secret"
    store.save(cfg, path)

    view = store.public_view(store.load(path))
    blob = json.dumps(view, ensure_ascii=False)
    assert "sk-super-secret" not in blob
    assert view["openai"]["has_key"] is True


def test_clear_key(tmp_path):
    path = tmp_path / "settings.json"
    cfg = store.load(path)
    cfg["openai"]["api_key"] = "sk-abc"
    store.save(cfg, path)

    merged = store.apply_patch({"openai": {"api_key": ""}}, path)
    assert merged["openai"]["api_key"] == ""
    assert store.public_view(merged)["openai"]["has_key"] is False


def test_invalid_provider_rejected(tmp_path):
    with pytest.raises(ValueError):
        store.apply_patch({"provider": "gemini"}, tmp_path / "s.json")


def test_openai_requires_base_url_and_model(tmp_path):
    path = tmp_path / "s.json"
    with pytest.raises(ValueError):
        store.apply_patch({"provider": "openai", "openai": {"base_url": "", "model": "m"}}, path)
    with pytest.raises(ValueError):
        store.apply_patch({"provider": "openai", "openai": {"base_url": "ftp://x", "model": "m"}}, path)
    with pytest.raises(ValueError):
        store.apply_patch({"provider": "openai", "openai": {"base_url": "https://x", "model": ""}}, path)


def test_active_provider():
    cfg = {"provider": "mock"}
    assert store.active_provider(cfg)["available"] is True

    real = {"provider": "openai", "openai": {"base_url": "https://x", "model": "m", "api_key": ""}}
    info = store.active_provider(real)
    assert info["provider"] == "openai"
    assert info["available"] is False

    real["openai"]["api_key"] = "sk-1"
    assert store.active_provider(real)["available"] is True


# ---------------------------------------------------------------- API 层


def test_get_settings_defaults(client):
    resp = client.get("/api/settings")
    assert resp.status_code == 200
    data = resp.json()
    assert data["settings"]["provider"] == "mock"
    assert data["settings"]["openai"]["model"] == "deepseek-chat"
    assert data["active"]["available"] is True


def test_put_settings_saves_and_masks_key(client):
    resp = client.put("/api/settings", json={"provider": "claude", "claude": {"api_key": "sk-ant-xyz"}})
    assert resp.status_code == 200
    body = resp.json()
    assert body["settings"]["provider"] == "claude"
    assert body["settings"]["claude"]["has_key"] is True
    assert "sk-ant-xyz" not in json.dumps(body)

    # 再次 GET 也不应包含明文
    again = client.get("/api/settings").json()
    assert again["settings"]["claude"]["has_key"] is True
    assert "sk-ant-xyz" not in json.dumps(again)


def test_put_settings_invalid(client):
    resp = client.put("/api/settings", json={"provider": "openai", "openai": {"base_url": "not-url"}})
    assert resp.status_code == 400


def test_put_settings_clear_key(client):
    client.put("/api/settings", json={"provider": "openai", "openai": {"api_key": "sk-abc", "base_url": "https://api.deepseek.com/v1", "model": "deepseek-chat"}})
    resp = client.put("/api/settings", json={"openai": {"api_key": ""}})
    assert resp.status_code == 200
    assert resp.json()["settings"]["openai"]["has_key"] is False
