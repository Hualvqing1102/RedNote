"""MVP 端到端验收走查：全新临时库 + 真实网页采集(微信公开文章)。"""
import json
import sqlite3
import tempfile
import sys

sys.stdout.reconfigure(encoding="utf-8")

from fastapi.testclient import TestClient
from app.server import create_app

WECHAT = "https://mp.weixin.qq.com/s/KbviOJ6q-K4ik_wzsUs2dw"

with tempfile.TemporaryDirectory() as tmp:
    db = f"{tmp}/e2e.db"
    settings = f"{tmp}/settings.json"
    app = create_app(db, settings)
    results = []

    def check(name, ok, extra=""):
        results.append((name, ok, extra))
        print(("PASS" if ok else "FAIL") + f"  {name} {extra}")

    with TestClient(app) as c:
        # 1 设置默认
        r = c.get("/api/settings")
        check("读取默认设置", r.status_code == 200 and r.json()["settings"]["provider"] == "mock")

        # 2 真实采集
        r = c.post("/api/collect", json={"url": WECHAT})
        check("真实网页采集", r.status_code == 200, f"len={len(r.json()['content'])}")
        art = r.json()["content"]

        # 3 总结(mock)
        r = c.post("/api/agent/summarize", json={"title": art[:0] or "标题", "content": art[:12000]})
        sm = r.json()
        check("Agent 总结", r.status_code == 200 and bool(sm.get("summary")), str(sm)[:80])

        # 4 建笔记(含 tags 与 points)
        note_body = {
            "title": "上下文工程(验收)",
            "summary": sm.get("summary", ""),
            "content": art,
            "points": sm.get("points", []),
            "tags": ["AI", "Agent"],
            "source_url": WECHAT,
        }
        r = c.post("/api/notes", json=note_body)
        check("创建笔记", r.status_code == 201, f"id={r.json()['id']}")
        note_id = r.json()["id"]

        # 5 列表/搜索/标签筛选
        check("列表包含笔记", any(n["id"] == note_id for n in c.get("/api/notes").json()))
        check("关键词搜索", len(c.get("/api/notes", params={"q": "上下文工程"}).json()) == 1)
        check("标签筛选", len(c.get("/api/notes", params={"tag": "AI"}).json()) == 1)

        # 6 追问(mock)
        r = c.post("/api/agent/ask", json={"note_id": note_id, "question": "什么是上下文工程"})
        check("笔记追问", r.status_code == 200 and len(r.json().get("answer", "")) > 0)

        # 7 注释(带 anchor)持久化
        comments = [
            {"id": "a1", "text": "验收注释一", "links": [{"title": "参考", "url": "https://example.com/x"}], "anchor": 0},
            {"id": "a2", "text": "验收注释二", "links": [], "anchor": 1},
        ]
        r = c.patch(f"/api/notes/{note_id}", json={"comments": comments})
        check("保存注释", r.status_code == 200 and len(r.json()["comments"]) == 2)
        got = c.get(f"/api/notes/{note_id}").json()
        check("注释回读", got["comments"][0]["anchor"] == 0 and got["comments"][1]["anchor"] == 1)

        # 8 更新正文
        r = c.patch(f"/api/notes/{note_id}", json={"content": art + "\n\n# 补充分节\n\n追加段落。"})
        check("更新正文", r.status_code == 200 and "补充分节" in r.json()["content"])

        # 9 导出单篇 md
        md = c.get(f"/api/notes/{note_id}/export.md").text
        check("导出 Markdown", "补充分节" in md and "验收注释一" in md)

        # 10 全部导出
        all_md = c.get("/api/export/notes.md").text
        check("全部导出", "上下文工程(验收)" in all_md)

        # 11 数据库备份可独立打开
        r = c.get("/api/export/backup.db")
        ok11 = r.status_code == 200 and r.content.startswith(b"SQLite format 3")
        backup = f"{tmp}/backup.db"
        with open(backup, "wb") as fh:
            fh.write(r.content)
        conn = sqlite3.connect(backup)
        n = conn.execute("SELECT COUNT(*) FROM notes").fetchone()[0]
        conn.close()
        check("数据库备份可还原", ok11 and n == 1)

        # 12 删除
        check("删除笔记", c.delete(f"/api/notes/{note_id}").status_code == 204)
        check("删除后 404", c.get(f"/api/notes/{note_id}").status_code == 404)

    failed = [x for x in results if not x[1]]
    print("\n==== E2E SUMMARY ====")
    print(f"total={len(results)} pass={len(results) - len(failed)} fail={len(failed)}")
    sys.exit(1 if failed else 0)
