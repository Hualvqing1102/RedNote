"""RedNote MCP 服务器（无第三方依赖，仅标准库 + 本机 RedNote 的 REST API）。

运行：python scripts/rednote_mcp.py
环境变量：
  REDNOTE_API_URL   RedNote 服务地址，默认 http://127.0.0.1:8000

通过 stdio 实现 MCP(Model Context Protocol) 的子集：
  initialize / notifications/initialized / ping / tools/list / tools/call
方便 Claude Code、Codex 等支持 MCP 的 Agent 接入；DSH 等可直接调用 HTTP 或脚本，无需本文件。

注意：RedNote 默认只监听 127.0.0.1，只在本机可访问；跨主机请按 docs/Agent 接入 RedNote.md 处理。
"""
from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request

BASE = os.getenv("REDNOTE_API_URL", "http://127.0.0.1:8000").rstrip("/")


def _request_json(method: str, path: str, payload: dict | None = None):
    """对 RedNote 发起 JSON 请求，返回解析后的 JSON。"""
    url = BASE + path
    data = None
    headers = {"Content-Type": "application/json"}
    if payload is not None:
        data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            body = resp.read().decode("utf-8")
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", "ignore")
        raise RuntimeError(f"RedNote {method} {path} -> {exc.code}: {body[:300]}") from exc
    except urllib.error.URLError as exc:
        raise RuntimeError(f"无法连接 RedNote（{BASE}）：{exc.reason}") from exc
    if not body:
        return None
    return json.loads(body)


# ---------------------------------------------------------------- 工具实现

TOOLS = [
    {
        "name": "search_notes",
        "description": "搜索 RedNote 笔记（关键词，标题/摘要/正文）并返回列表。",
        "inputSchema": {
            "type": "object",
            "properties": {"q": {"type": "string", "description": "搜索关键词，可为空"}},
        },
    },
    {
        "name": "get_note",
        "description": "读取一篇 RedNote 笔记的标题、摘要、要点、正文与来源。",
        "inputSchema": {
            "type": "object",
            "properties": {"id": {"type": "integer", "description": "笔记 id"}},
            "required": ["id"],
        },
    },
    {
        "name": "list_folders",
        "description": "列出 RedNote 的收藏夹。",
        "inputSchema": {"type": "object", "properties": {}},
    },
    {
        "name": "import_note",
        "description": "把一段讲解/总结内容导入为 RedNote 笔记（含标题/摘要/要点/来源）。",
        "inputSchema": {
            "type": "object",
            "properties": {
                "content": {"type": "string", "description": "讲解/总结正文（必填）"},
                "title": {"type": "string"},
                "summary": {"type": "string"},
                "points": {"type": "array", "items": {"type": "string"}},
                "source_url": {"type": "string"},
                "source_name": {"type": "string"},
                "folder": {"type": "string", "description": "目标收藏夹名称（可选，将按名匹配/创建）"},
            },
            "required": ["content"],
        },
    },
]


def _folder_id(folder_name: str) -> int | None:
    if not folder_name:
        return None
    folders = _request_json("GET", "/api/folders")
    for f in folders:
        if f["name"] == folder_name:
            return f["id"]
    created = _request_json("POST", "/api/folders", {"name": folder_name})
    return created["id"]


def execute(name: str, args: dict) -> tuple[str, bool]:
    """执行一个工具，返回 (文本, 是否错误)。"""
    if name == "search_notes":
        items = _request_json("GET", "/api/notes" + _q(args.get("q", "")))
        return _dump(items), False
    if name == "get_note":
        nid = int(args.get("id") or 0)
        note = _request_json("GET", f"/api/notes/{nid}")
        return _dump(note), False
    if name == "list_folders":
        return _dump(_request_json("GET", "/api/folders")), False
    if name == "import_note":
        content = (args.get("content") or "").strip()
        if not content:
            return "错误：content 不能为空", True
        payload = {
            "title": args.get("title", ""),
            "summary": args.get("summary", ""),
            "points": args.get("points", []),
            "content": content,
            "source_url": args.get("source_url", ""),
            "source_name": args.get("source_name", ""),
        }
        folder = int(args["folder"]) if str(args.get("folder") or "").isdigit() else None
        if not folder and args.get("folder"):
            folder = _folder_id(str(args["folder"]))
        if folder:
            payload["folder_id"] = folder
        note = _request_json("POST", "/api/import/agent", payload)
        return f"已导入笔记 id={note['id']} title={note['title']}", False
    return f"未知工具：{name}", True


def _q(q: str) -> str:
    return ("?q=" + urllib.parse.quote(q)) if q.strip() else ""


def _dump(obj) -> str:
    return json.dumps(obj, ensure_ascii=False, indent=2)


# ---------------------------------------------------------------- MCP 会话

def _reply(msg_id, result=None, error=None) -> bytes:
    body: dict = {"jsonrpc": "2.0", "id": msg_id}
    if error is not None:
        body["error"] = {"code": -32000, "message": str(error)}
    else:
        body["result"] = result
    return (json.dumps(body, ensure_ascii=False) + "\n").encode("utf-8")


def serve() -> None:
    for line in sys.stdin.buffer:
        line = line.strip()
        if not line:
            continue
        try:
            msg = json.loads(line.decode("utf-8"))
        except json.JSONDecodeError:
            continue
        method = msg.get("method")
        mid = msg.get("id")
        if method == "initialize":
            sys.stdout.buffer.write(
                _reply(
                    mid,
                    {
                        "protocolVersion": "2024-11-05",
                        "capabilities": {"tools": {}},
                        "serverInfo": {"name": "rednote-mcp", "version": "0.1.0"},
                    },
                )
            )
        elif method == "notifications/initialized":
            continue
        elif method == "ping":
            sys.stdout.buffer.write(_reply(mid, {}))
        elif method == "tools/list":
            sys.stdout.buffer.write(_reply(mid, {"tools": TOOLS}))
        elif method == "tools/call":
            params = msg.get("params", {})
            name = params.get("name", "")
            args = params.get("arguments", {})
            try:
                text, is_err = execute(name, args)
            except Exception as exc:  # noqa: BLE001
                text, is_err = str(exc), True
            sys.stdout.buffer.write(
                _reply(
                    mid,
                    {
                        "content": [{"type": "text", "text": text}],
                        "isError": is_err,
                    },
                )
            )
        else:
            if mid is not None:
                sys.stdout.buffer.write(
                    _reply(mid, error={"code": -32601, "message": f"Method not found: {method}"})
                )
        sys.stdout.buffer.flush()


if __name__ == "__main__":
    serve()
