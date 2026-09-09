"""数据存储位置服务：用户可自选笔记目录(桌面版)。

机制：
- 有一个"锚点目录"固定不变，里面放 data_location.txt 记录用户自选的绝对路径；
- run_desktop 每次启动先读该文件(若存在且有效)设置 REDNOTE_DATA_DIR；
- 设置页可迁移：把 rednote.db / settings.json / attachments 复制到新目录，
  再写(或删除)锚点文件，重启后生效(复制不动原文件，安全)。

锚点：优先取环境变量 REDNOTE_DATA_DIR_ANCHOR(测试用)；
否则 exe 用 %APPDATA%\\RedNote，源码环境用项目 data/。
"""
from __future__ import annotations

import os
import shutil
import sys
from pathlib import Path

from app import config


def anchor_dir() -> Path:
    env = os.getenv("REDNOTE_DATA_DIR_ANCHOR")
    if env:
        return Path(env).resolve()
    if getattr(sys, "frozen", False) or os.getenv("REDNOTE_DESKTOP") == "1":
        base = os.environ.get("APPDATA") or str(Path.home())
        return Path(base) / "RedNote"
    return config.PROJECT_ROOT / "data"


def location_file() -> Path:
    return anchor_dir() / "data_location.txt"


def current_dir() -> Path:
    """当前生效的数据目录(config.data_dir：env 或锚点已由启动逻辑注入)。"""
    return config.data_dir()


def read_location() -> Path | None:
    pointer = location_file()
    try:
        text = pointer.read_text(encoding="utf-8").strip()
    except OSError:
        return None
    if not text:
        return None
    p = Path(text)
    return p if p.is_absolute() else None


def write_location(path: Path) -> None:
    anchor = anchor_dir()
    anchor.mkdir(parents=True, exist_ok=True)
    location_file().write_text(str(path.resolve()), encoding="utf-8")


def clear_location() -> None:
    try:
        location_file().unlink()
    except OSError:
        pass


def migrate_to(target: str | Path, source: str | Path | None = None) -> dict:
    """把数据从 source(默认当前数据目录)复制到 target，不删除原文件。"""
    src = Path(source or current_dir()).resolve()
    raw = Path(str(target).strip())
    if not raw.is_absolute():
        raise ValueError("请填写绝对路径（如 D:\\Notes\\RedNote）")
    dst = raw.resolve()
    if src == dst:
        raise ValueError("目标位置与当前位置相同")
    try:
        dst.mkdir(parents=True, exist_ok=True)
    except OSError as exc:
        raise ValueError(f"无法创建目标目录：{exc}") from exc
    if not os.access(dst, os.W_OK):
        raise ValueError("目标目录不可写")

    moved: list[str] = []
    for name in ("rednote.db", "settings.json"):
        f = src / name
        if f.is_file():
            shutil.copy2(f, dst / name)
            moved.append(name)
    att_src = src / "attachments"
    if att_src.is_dir():
        att_dst = dst / "attachments"
        if att_dst.exists():
            shutil.rmtree(att_dst)
        shutil.copytree(att_src, att_dst)
        moved.append("attachments")
    return {"moved": moved, "dir": str(dst)}
