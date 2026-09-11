"""RedNote 桌面启动入口（供 PyInstaller 打包为 exe，也可源码运行）。

双击 exe / 运行本文件时：
1. 启动本地 FastAPI 服务（127.0.0.1 随机空闲端口）；
2. 等待服务就绪后，用 pywebview 打开一个桌面窗口加载应用，
   不再需要手动开浏览器。

数据目录：打包(exe)运行时默认落在 %APPDATA%\\RedNote；
可用环境变量 REDNOTE_DATA_DIR 覆盖；固定端口可用 REDNOTE_DESKTOP_PORT。
"""
from __future__ import annotations

import base64
import logging
import os
import re
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


def _enable_downloads() -> bool:
    """打开 pywebview 的下载开关（默认 False 会把下载静默取消）。

    桌面版里「导出 Markdown / 备份数据库 / 下载附件」都是 <a download> 触发的下载。
    pywebview 6.x 的 settings['ALLOW_DOWNLOADS'] 默认 False，会在
    on_download_starting 里直接 args.Cancel = True 后 return —— 连「另存为」窗口都
    不创建、也不报错，用户看到的就是"点了没反应"。必须在 webview.start() 之前打开。
    """
    try:
        import webview

        webview.settings["ALLOW_DOWNLOADS"] = True
        return bool(webview.settings["ALLOW_DOWNLOADS"])
    except Exception as exc:  # noqa: BLE001 - 开关失败不阻塞启动，仅记录
        logging.getLogger(__name__).warning("打开下载开关失败：%s", exc)
        return False


_ILLEGAL_FILENAME_CHARS = re.compile(r'[\\/:*?"<>|\r\n\t]')


def _safe_filename(name: str, fallback: str = "rednote-export") -> str:
    """把用户可控的名字（如笔记标题）清洗成合法文件名：保留中文，去掉路径与非法字符。"""
    cleaned = _ILLEGAL_FILENAME_CHARS.sub(" ", name or "")
    cleaned = re.sub(r"\s+", " ", cleaned).strip().rstrip(". ")
    if not cleaned:
        cleaned = fallback
    stem, ext = os.path.splitext(cleaned)
    stem = (stem.strip() or fallback)[:100].rstrip(". ")
    return f"{stem}{ext}" if ext else stem


def _default_save_dir() -> str:
    """「另存为」的初始目录：优先系统下载目录，其次数据目录。"""
    downloads = Path(os.environ.get("USERPROFILE") or Path.home()) / "Downloads"
    if downloads.is_dir():
        return str(downloads)
    return os.getenv("REDNOTE_DATA_DIR") or "."


def _file_types_for(filename: str) -> tuple[str, ...]:
    """按扩展名给出「另存为」的文件类型过滤器（描述须为 ASCII，见 pywebview.parse_file_type）。"""
    suffix = Path(filename).suffix.lower()
    if suffix == ".md":
        return ("Markdown (*.md)",)
    if suffix == ".db":
        return ("SQLite backup (*.db)",)
    return ("All files (*.*)",)


def _setup_logging() -> None:
    """把运行日志写入数据目录 desktop.log，便于桌面版排障。"""
    import logging

    try:
        base = Path(os.getenv("REDNOTE_DATA_DIR") or "data")
        handler = logging.FileHandler(base / "desktop.log", encoding="utf-8")
        handler.setFormatter(
            logging.Formatter("%(asctime)s %(levelname)s %(name)s: %(message)s")
        )
        root = logging.getLogger()
        root.addHandler(handler)
        root.setLevel(logging.INFO)
    except Exception:  # noqa: BLE001 - 日志失败不影响启动
        pass


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


def _warm_http_client(url: str) -> None:
    """在加载 pythonnet(窗口)之前预热 httpx/httpcore 的异步后端模块。

    原因：pythonnet 会向 sys.meta_path 注入自己的导入查找器，若 httpx 首次请求时
    才动态导入 trio/sniffio 等后端，会撞上该查找器并抛
    'module clr has no attribute _available_namespaces'（仅打包 exe 内出现）。
    先在主线程跑一次真实请求，让这些模块进入 sys.modules，之后便不再动态导入。
    """
    try:
        import asyncio
        import httpx

        async def _run() -> None:
            async with httpx.AsyncClient(timeout=8.0) as client:
                await client.get(url + "/api/notes")

        asyncio.run(_run())
    except Exception:  # noqa: BLE001 - 预热失败不阻塞，后续仍可运行
        pass


class DesktopApi:
    """桌面壳暴露给前端的本地能力(js_api)：
    - choose_file(): 原生文件对话框，返回 {ok, path, name}；
    - choose_folder(): 原生「选择文件夹」对话框；
    - open_path(path): 用系统默认程序打开本地文件；
    - save_file(filename, content_b64): 原生「另存为」→ 把导出内容落盘并回传真实路径。

    注意：本对象绝不反向持有 window 引用——pywebview 自动暴露 js_api 时会递归
    遍历对象图，若 api 持有 window 会把整个窗口对象(含 .NET 控件代理)带进遍历，
    每次 getattr 生成新代理导致无限递归、窗口卡死。取窗口一律用 webview.windows。
    """

    def __init__(self, save_dialog=None) -> None:
        """save_dialog: 测试注入的假「另存为」((filename, initial_dir) -> 路径|None)；
        为 None 时使用 pywebview 的原生对话框。"""
        self._save_dialog = save_dialog

    def _ask_save_path(self, filename: str) -> str | None:
        """弹原生「另存为」，返回用户选定路径；取消返回 None。"""
        initial_dir = _default_save_dir()
        if self._save_dialog is not None:
            return self._save_dialog(filename, initial_dir)

        import webview

        picked = webview.windows[0].create_file_dialog(
            webview.FileDialog.SAVE,
            directory=initial_dir,
            save_filename=filename,
            file_types=_file_types_for(filename),
        )
        if not picked:
            return None
        return str(picked[0] if isinstance(picked, (list, tuple)) else picked)

    def save_file(self, filename: str, content_b64: str) -> dict:
        """把前端取到的导出内容保存到用户选定位置，返回 {ok, path, bytes}。

        前端从 /api/export/* 取内容并转 base64 后调用本方法；本方法只负责
        "选路径 + 落盘"，因此导出格式仍由后端单一来源决定。
        """
        try:
            data = base64.b64decode(content_b64 or "")
        except Exception as exc:  # noqa: BLE001
            return {"ok": False, "error": f"导出内容解码失败：{exc}"}

        name = _safe_filename(filename)
        try:
            target = self._ask_save_path(name)
        except Exception as exc:  # noqa: BLE001
            return {"ok": False, "error": f"无法打开保存对话框：{exc}"}
        if not target:
            return {"ok": False, "cancelled": True}

        try:
            path = Path(target)
            path.write_bytes(data)
        except OSError as exc:
            return {"ok": False, "error": f"写入文件失败：{exc}"}
        return {"ok": True, "path": str(path), "bytes": len(data)}

    def choose_file(self) -> dict:
        import webview

        try:
            picked = webview.windows[0].create_file_dialog(
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

    def choose_folder(self) -> dict:
        """选择文件夹(设置页「数据存储位置」用)。"""
        import webview

        try:
            picked = webview.windows[0].create_file_dialog(webview.FOLDER_DIALOG)
        except Exception as exc:  # noqa: BLE001
            return {"ok": False, "error": str(exc)}
        if not picked:
            return {"ok": False, "cancelled": True}
        path = picked[0] if isinstance(picked, (list, tuple)) else picked
        return {"ok": True, "path": str(path)}

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
        # exe 运行时数据放用户目录；若设置了“自选存储位置”(锚点文件)则优先使用
        if not os.getenv("REDNOTE_DATA_DIR"):
            base = os.environ.get("APPDATA") or str(Path.home())
            anchor = Path(base) / "RedNote"
            chosen = ""
            try:
                chosen = (anchor / "data_location.txt").read_text(encoding="utf-8").strip()
            except OSError:
                pass
            if chosen and Path(chosen).is_absolute():
                os.environ["REDNOTE_DATA_DIR"] = chosen
            else:
                os.environ["REDNOTE_DATA_DIR"] = str(anchor)

    _setup_logging()

    from app.server import create_app

    import uvicorn
    import webview

    _enable_downloads()  # 必须早于 webview.start()，否则导出/附件下载被静默取消

    port = int(os.getenv("REDNOTE_DESKTOP_PORT") or 0)
    if not port:
        port = _pick_port()

    app = create_app()
    server = uvicorn.Server(
        uvicorn.Config(
            app,
            host="127.0.0.1",
            port=port,
            log_level="warning",
            # 不接管 logging 配置：由 _setup_logging 统一写 desktop.log，
            # 否则 uvicorn 的 dictConfig 会替换掉我们挂到 root 的文件 handler
            log_config=None,
        )
    )
    thread = threading.Thread(target=server.run, daemon=True)
    thread.start()

    url = f"http://127.0.0.1:{port}"
    _wait_ready(url)
    _warm_http_client(url)  # 必须先于 pythonnet/窗口，见 _warm_http_client 说明

    api = DesktopApi()
    window = webview.create_window(
        "RedNote 学习笔记",
        url=url,
        width=1280,
        height=860,
        min_size=(980, 640),
        js_api=api,
    )
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
