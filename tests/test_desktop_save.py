"""桌面版下载/导出桥测试。

背景（回归防护）：pywebview 6.x 的 settings['ALLOW_DOWNLOADS'] 默认 False，
会在 on_download_starting 里直接 args.Cancel=True 后 return —— 桌面版里所有
<a download>（导出 Markdown / 备份数据库 / 附件下载）都被静默取消，既无对话框
也无报错。这里锁死两件事：
1) 启动时必须打开该开关（且早于 webview.start()）；
2) 导出走桌面桥 save_file 时能正确落盘并回传真实路径。
"""
from __future__ import annotations

import base64

import pytest

import run_desktop


# ---------------------------------------------------------------- 下载开关


def test_enable_downloads_turns_on_allow_downloads():
    import webview

    assert run_desktop._enable_downloads() is True
    assert webview.settings["ALLOW_DOWNLOADS"] is True


def test_main_enables_downloads_before_webview_start(monkeypatch, tmp_path):
    """集成断言：main() 在 webview.start() 之前就把下载开关打开。"""
    import uvicorn
    import webview

    monkeypatch.setenv("REDNOTE_DATA_DIR", str(tmp_path))
    monkeypatch.setenv("REDNOTE_DESKTOP_PORT", "8123")
    monkeypatch.setattr(run_desktop, "_wait_ready", lambda url, timeout=0.0: None)
    monkeypatch.setattr(run_desktop, "_warm_http_client", lambda url: None)
    # 用普通 dict 替换 pywebview 的设置对象：既验证赋值路径，也不污染全局单例
    monkeypatch.setattr(webview, "settings", dict(webview.settings))

    class _StubServer:
        def __init__(self, config=None):
            self.should_exit = False

        def run(self):
            return None

    monkeypatch.setattr(uvicorn, "Server", _StubServer)
    monkeypatch.setattr(uvicorn, "Config", lambda *a, **k: None)
    monkeypatch.setattr(webview, "create_window", lambda *a, **k: None)

    seen: dict[str, object] = {}

    def _record_start(*args, **kwargs):
        seen["allow_downloads"] = webview.settings["ALLOW_DOWNLOADS"]

    monkeypatch.setattr(webview, "start", _record_start)

    assert run_desktop.main() == 0
    assert seen["allow_downloads"] is True


# ---------------------------------------------------------------- 文件名清洗


@pytest.mark.parametrize(
    "raw,expected",
    [
        ("我的笔记.md", "我的笔记.md"),
        ('a/b\\c:d*e?f"g<h>i|j.md', "a b c d e f g h i j.md"),
        ("  多余   空格.md ", "多余 空格.md"),
        ("结尾点...", "结尾点"),
        ("", "rednote-export"),
        ("...", "rednote-export"),
    ],
)
def test_safe_filename(raw, expected):
    assert run_desktop._safe_filename(raw) == expected


def test_safe_filename_truncates_long_stem_but_keeps_extension():
    name = run_desktop._safe_filename("标" * 300 + ".md")
    assert name.endswith(".md")
    assert len(name) <= 100 + len(".md")


def test_file_types_for():
    assert run_desktop._file_types_for("a.md") == ("Markdown (*.md)",)
    assert run_desktop._file_types_for("a.db") == ("SQLite backup (*.db)",)
    assert run_desktop._file_types_for("a.bin") == ("All files (*.*)",)


def test_default_save_dir_prefers_downloads(monkeypatch, tmp_path):
    monkeypatch.setenv("USERPROFILE", str(tmp_path))
    (tmp_path / "Downloads").mkdir()
    assert run_desktop._default_save_dir() == str(tmp_path / "Downloads")


def test_default_save_dir_falls_back_to_data_dir(monkeypatch, tmp_path):
    monkeypatch.setenv("USERPROFILE", str(tmp_path))  # 无 Downloads 目录
    monkeypatch.setenv("REDNOTE_DATA_DIR", str(tmp_path / "mydata"))
    assert run_desktop._default_save_dir() == str(tmp_path / "mydata")


# ---------------------------------------------------------------- 保存桥


def test_save_file_writes_bytes_and_returns_path(tmp_path):
    target = tmp_path / "导出结果.md"
    api = run_desktop.DesktopApi(save_dialog=lambda name, initial: str(target))

    result = api.save_file("我的笔记.md", base64.b64encode("正文内容".encode()).decode())

    assert result["ok"] is True
    assert result["path"] == str(target)
    assert result["bytes"] == len("正文内容".encode())
    assert target.read_bytes() == "正文内容".encode()


def test_save_file_sanitizes_suggested_name(tmp_path):
    seen: dict[str, str] = {}

    def _dialog(name: str, initial: str) -> str:
        seen["name"] = name
        seen["initial"] = initial
        return str(tmp_path / "out.md")

    api = run_desktop.DesktopApi(save_dialog=_dialog)
    api.save_file('非法:名*字?.md', base64.b64encode(b"x").decode())

    assert seen["name"] == "非法 名 字.md"
    assert seen["initial"]  # 初始目录非空（下载目录或数据目录）


def test_save_file_cancelled_writes_nothing(tmp_path):
    api = run_desktop.DesktopApi(save_dialog=lambda name, initial: None)

    result = api.save_file("x.md", base64.b64encode(b"data").decode())

    assert result == {"ok": False, "cancelled": True}
    assert list(tmp_path.iterdir()) == []


def test_save_file_rejects_bad_base64(tmp_path):
    api = run_desktop.DesktopApi(save_dialog=lambda name, initial: str(tmp_path / "x.md"))

    result = api.save_file("x.md", "A")  # 非法 base64

    assert result["ok"] is False
    assert "解码失败" in result["error"]


def test_save_file_reports_write_error(tmp_path):
    missing = tmp_path / "no-such-dir" / "x.md"
    api = run_desktop.DesktopApi(save_dialog=lambda name, initial: str(missing))

    result = api.save_file("x.md", base64.b64encode(b"data").decode())

    assert result["ok"] is False
    assert "写入文件失败" in result["error"]


def test_save_file_reports_dialog_error(tmp_path):
    def _boom(name: str, initial: str) -> str:
        raise RuntimeError("dialog broken")

    api = run_desktop.DesktopApi(save_dialog=_boom)

    result = api.save_file("x.md", base64.b64encode(b"data").decode())

    assert result["ok"] is False
    assert "无法打开保存对话框" in result["error"]
