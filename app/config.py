"""应用配置：数据目录与数据库路径。

优先读取环境变量 REDNOTE_DATA_DIR；未设置时默认落在项目根目录下的 data/。
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent


def data_dir() -> Path:
    env = os.getenv("REDNOTE_DATA_DIR")
    if env:
        return Path(env).resolve()
    return PROJECT_ROOT / "data"


def db_path() -> Path:
    return data_dir() / "rednote.db"


def frontend_dist_dir() -> Path | None:
    """前端构建产物目录：打包后的 exe 从资源区取，源码运行取 frontend/dist。"""
    meipass = getattr(sys, "_MEIPASS", None)
    if meipass:
        bundled = Path(meipass) / "frontend_dist"
        if bundled.is_dir():
            return bundled
    dist = PROJECT_ROOT / "frontend" / "dist"
    return dist if dist.is_dir() else None
