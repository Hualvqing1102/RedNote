"""RedNote 桌面启动入口（供 PyInstaller 打包为 exe，也可源码运行）。

双击 exe / 运行本文件时：
1. 启动本地 FastAPI 服务（127.0.0.1 随机空闲端口）；
2. 等待服务就绪后，用 pywebview 打开一个桌面窗口加载应用，
   不再需要手动开浏览器。

数据目录：打包(exe)运行时默认落在 %APPDATA%\\RedNote；
可用环境变量 REDNOTE_DATA_DIR 覆盖；固定端口可用 REDNOTE_DESKTOP_PORT。
"""
from __future__ import annotations

import os
import socket
import sys
import threading
import time
import urllib.request
from pathlib import Path


def _pick_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def _wait_ready(url: str, timeout: float = 40.0) -> None:
    deadline = time.time() + timeout
    last_error: Exception | None = None
    while time.time() < deadline:
        try:
            with urllib.request.urlopen(url + "/api/notes", timeout=1.5) as resp:
                if resp.status == 200:
                    return
        except Exception as exc:  # noqa: BLE001 - 服务未就绪属正常
            last_error = exc
        time.sleep(0.15)
    raise RuntimeError(f"本地服务启动超时：{last_error}")


class DesktopApi:
    """桌面壳暴露给前端的本地能力(js_api)：
    - choose_file(): 原生文件对话框，返回 {ok, path, name}；
    - open_path(path): 用系统默认程序打开本地文件。
    """

    def __init__(self) -> None:
        self.window = None

    def choose_file(self) -> dict:
        import webview

        try:
            picked = self.window.create_file_dialog(
                webview.OPEN_DIALOG,
                allow_multiple=False,
                file_types=("文档 (*.pdf;*.docx;*.txt;*.md)",),
            )
        except Exception as exc:  # noqa: BLE001
            return {"ok": False, "error": str(exc)}
        if not picked:
            return {"ok": False, "cancelled": True}
        path = picked[0] if isinstance(picked, (list, tuple)) else picked
        return {"ok": True, "path": str(path), "name": os.path.basename(str(path))}

    def open_path(self, path: str) -> dict:
        try:
            os.startfile(path)
            return {"ok": True}
        except Exception as exc:  # noqa: BLE001
            return {"ok": False, "error": str(exc)}


def main() -> int:
    # 桌面运行标记：开放“读取本机文件路径”这类仅桌面可用的接口
    os.environ["REDNOTE_DESKTOP"] = "1"
    if getattr(sys, "frozen", False):
        # exe 运行时默认把数据放在用户目录，避免写在安装位置不可写
        if not os.getenv("REDNOTE_DATA_DIR"):
            base = os.environ.get("APPDATA") or str(Path.home())
            os.environ["REDNOTE_DATA_DIR"] = str(Path(base) / "RedNote")

    from app.server import create_app

    import uvicorn
    import webview

    port = int(os.getenv("REDNOTE_DESKTOP_PORT") or 0)
    if not port:
        port = _pick_port()

    app = create_app()
    server = uvicorn.Server(
        uvicorn.Config(app, host="127.0.0.1", port=port, log_level="warning")
    )
    thread = threading.Thread(target=server.run, daemon=True)
    thread.start()

    url = f"http://127.0.0.1:{port}"
    _wait_ready(url)

    api = DesktopApi()
    window = webview.create_window(
        "RedNote 学习笔记",
        url=url,
        width=1280,
        height=860,
        min_size=(980, 640),
        js_api=api,
    )
    api.window = window
    webview.start()
    server.should_exit = True
    thread.join(timeout=5)
    try:
        window.destroy()
    except Exception:  # noqa: BLE001 - 窗口可能已随 webview.start 结束
        pass
    return 0


if __name__ == "__main__":
    sys.exit(main())
