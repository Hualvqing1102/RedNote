"""笔记本体改进测试：手改标题/摘要/要点、回收站(软删除)、附件归档。"""
from __future__ import annotations

from pathlib import Path


def _mk(client, title="笔记", content="正文内容 关键词甲 的内容", summary="", points=None):
    resp = client.post(
        "/api/notes",
        json={
            "title": title,
            "summary": summary,
            "content": content,
            "points": points or [],
            "source_url": "",
            "source_snapshot": "",
        },
    )
    assert resp.status_code == 201
    return resp.json()


# ---------------------------------------------------------------- 手改字段


def test_manual_edit_title_summary_points(client):
    note = _mk(client, title="原标题", summary="AI 摘要", points=["AI 要点"])
    resp = client.patch(
        f"/api/notes/{note['id']}",
        json={"title": "手改标题", "summary": "手动摘要", "points": ["要点A", "要点B"]},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["title"] == "手改标题"
    assert body["summary"] == "手动摘要"
    assert body["points"] == ["要点A", "要点B"]


# ---------------------------------------------------------------- 回收站


def test_soft_delete_restore_purge(client):
    note = _mk(client, title="要删除的")
    nid = note["id"]

    assert client.delete(f"/api/notes/{nid}").status_code == 204
    # 普通列表/详情/搜索都看不到
    assert client.get(f"/api/notes/{nid}").status_code == 404
    assert all(n["id"] != nid for n in client.get("/api/notes").json())
    found = client.get("/api/notes", params={"q": "关键词甲"}).json()
    assert all(n["id"] != nid for n in found)
    trash = client.get("/api/notes", params={"deleted": 1}).json()
    assert [n["id"] for n in trash] == [nid]

    # 恢复
    restored = client.post(f"/api/notes/{nid}/restore")
    assert restored.status_code == 200
    assert client.get(f"/api/notes/{nid}").status_code == 200
    assert client.get("/api/notes", params={"deleted": 1}).json() == []

    # 再次移入回收站后彻底删除
    client.delete(f"/api/notes/{nid}")
    assert client.delete(f"/api/notes/{nid}/purge").status_code == 204
    assert client.get(f"/api/notes/{nid}").status_code == 404
    assert client.get("/api/notes", params={"deleted": 1}).json() == []


def test_empty_trash(client):
    a = _mk(client, title="甲")
    b = _mk(client, title="乙")
    client.delete(f"/api/notes/{a['id']}")
    client.delete(f"/api/notes/{b['id']}")
    resp = client.post("/api/notes/trash/empty")
    assert resp.status_code == 200
    assert resp.json()["removed"] == 2
    assert client.get("/api/notes", params={"deleted": 1}).json() == []


# ---------------------------------------------------------------- 附件


def test_attachment_upload_download_delete(client, tmp_path):
    note = _mk(client, title="带附件")
    nid = note["id"]

    up = client.post(
        f"/api/notes/{nid}/files",
        files={"file": ("paper.pdf", b"%PDF-1.4 fake pdf bytes", "application/pdf")},
    )
    assert up.status_code == 200
    files = up.json()["files"]
    assert len(files) == 1
    token = files[0]["id"]
    assert files[0]["name"] == "paper.pdf"
    assert files[0]["size"] == len(b"%PDF-1.4 fake pdf bytes")

    # 附件确实落盘在数据目录(以测试库目录推导)
    assert client.get(f"/api/notes/{nid}/files/{token}").status_code == 200

    # 下载内容一致
    dl = client.get(f"/api/notes/{nid}/files/{token}")
    assert dl.content == b"%PDF-1.4 fake pdf bytes"

    # 删除附件
    assert client.delete(f"/api/notes/{nid}/files/{token}").status_code == 204
    assert client.get(f"/api/notes/{nid}").json()["files"] == []
    assert client.get(f"/api/notes/{nid}/files/{token}").status_code == 404


def test_attachment_reject_unknown_ext_and_missing_note(client):
    note = _mk(client, title="x")
    resp = client.post(f"/api/notes/{note['id']}/files", files={"file": ("a.exe", b"x", "application/octet-stream")})
    assert resp.status_code == 400
    assert client.post("/api/notes/99999/files", files={"file": ("a.pdf", b"x", "application/pdf")}).status_code == 400


def test_purge_removes_attachment_folder(client, db_path):
    note = _mk(client, title="归档删除")
    nid = note["id"]
    client.post(f"/api/notes/{nid}/files", files={"file": ("a.txt", "内容".encode(), "text/plain")})
    folder = Path(db_path).parent / "attachments" / str(nid)
    assert folder.is_dir()
    client.delete(f"/api/notes/{nid}")
    client.delete(f"/api/notes/{nid}/purge")
    assert not folder.exists()
