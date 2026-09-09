"""RedNote 跨会话导入助手（Agent 写入桥的 CLI 版）。

用途：任何 DSH 会话/其它工程，只要在同一台电脑上，就可以把「讲解/总结正文 + 来源 +
原文件」导入 RedNote（默认数据目录 %APPDATA%\\RedNote，可用 REDNOTE_DATA_DIR 覆盖）。

示例（从任意目录调用本仓库的 venv python）：
  python H:/RedNote工程文件夹/scripts/rednote_import.py \
      --title "上下文工程讲解" \
      --summary "一句话摘要" \
      --point "要点一" --point "要点二" \
      --source-url "https://www.anthropic.com/..." \
      --source-name "Anthropic 官方文章" \
      --content-file note.md \
      --file paper.pdf
  # 无文件时也可直接传正文： --content "讲解正文…"

注意：写 %APPDATA% 可能需要在允许完整权限的环境运行；沙箱只读会话请先授权。
"""
from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))


def _data_dir() -> Path:
    env = os.getenv("REDNOTE_DATA_DIR")
    if env:
        return Path(env).resolve()
    return Path(os.environ.get("APPDATA", str(Path.home()))) / "RedNote"


def main(argv: list[str] | None = None) -> int:
    from app.db import init_db
    from app.services import notes as svc

    parser = argparse.ArgumentParser(description="把讲解/总结内容导入 RedNote")
    parser.add_argument("--title", default="")
    parser.add_argument("--summary", default="")
    parser.add_argument("--point", action="append", default=[], help="要点，可多次")
    parser.add_argument("--source-url", default="")
    parser.add_argument("--source-name", default="")
    parser.add_argument("--content", default="", help="讲解/总结正文（与 --content-file 二选一）")
    parser.add_argument("--content-file", default="", help="从文件读正文（UTF-8）")
    parser.add_argument("--file", default="", help="可选：原文件(论文/PDF 等)作为附件归档")
    args = parser.parse_args(argv)

    if args.content_file:
        content = Path(args.content_file).read_bytes().decode("utf-8")
    else:
        content = args.content
    content = content.strip()
    if not content:
        print("错误：正文为空（用 --content 或 --content-file）", file=sys.stderr)
        return 2

    db = _data_dir() / "rednote.db"
    init_db(db)
    note = svc.create_note(
        db,
        {
            "title": args.title,
            "summary": args.summary,
            "content": content,
            "points": [p.strip() for p in args.point if p.strip()],
            "source_url": args.source_url,
            "source_snapshot": args.source_name,
        },
    )
    if args.file:
        data = Path(args.file).read_bytes()
        try:
            svc.add_attachment(db, note["id"], Path(args.file).name, data)
        except ValueError as exc:
            print(f"警告：附件未归档（{exc}）", file=sys.stderr)

    print(f"saved note id={note['id']} db={db}")
    print(f"title: {note['title']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
