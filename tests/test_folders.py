"""收藏夹 API 测试：增删改查、重名、删除后笔记自动回到未分类。"""
from __future__ import annotations


def test_folder_full_crud(client):
    # 新建
    resp = client.post("/api/folders", json={"name": "AI 前沿"})
    assert resp.status_code == 201
    folder_id = resp.json()["id"]

    # 列表含计数
    folders = client.get("/api/folders").json()
    assert any(f["id"] == folder_id and f["name"] == "AI 前沿" for f in folders)

    # 改名
    resp = client.patch(f"/api/folders/{folder_id}", json={"name": "AI 论文"})
    assert resp.status_code == 200
    assert resp.json()["name"] == "AI 论文"

    # 删除
    assert client.delete(f"/api/folders/{folder_id}").status_code == 204
    assert client.get("/api/folders").json() == []


def test_folder_duplicate_and_empty_name(client):
    client.post("/api/folders", json={"name": "同名"})
    assert client.post("/api/folders", json={"name": "同名"}).status_code == 400
    assert client.post("/api/folders", json={"name": "  "}).status_code == 400
    assert client.patch("/api/folders/99999", json={"name": "x"}).status_code == 404


def test_assign_note_to_folder_and_filter(client):
    note = client.post("/api/notes", json={"title": "收藏夹里的笔记", "content": "正文"}).json()
    folder = client.post("/api/folders", json={"name": "工作"}).json()

    # 把笔记放进收藏夹
    resp = client.patch(f"/api/notes/{note['id']}", json={"folder_id": folder["id"]})
    assert resp.status_code == 200
    assert resp.json()["folder_id"] == folder["id"]
    assert resp.json()["folder_name"] == "工作"

    # 按收藏夹筛选
    listed = client.get("/api/notes", params={"folder": folder["id"]}).json()
    assert [n["id"] for n in listed] == [note["id"]]

    # 计数反映
    folders = client.get("/api/folders").json()
    work = next(f for f in folders if f["id"] == folder["id"])
    assert work["note_count"] == 1


def test_delete_folder_clears_assignment(client):
    note = client.post("/api/notes", json={"title": "x", "content": "y"}).json()
    folder = client.post("/api/folders", json={"name": "临时"}).json()
    client.patch(f"/api/notes/{note['id']}", json={"folder_id": folder["id"]})
    assert client.delete(f"/api/folders/{folder['id']}").status_code == 204

    got = client.get(f"/api/notes/{note['id']}").json()
    assert got["folder_id"] is None
    assert got["folder_name"] == ""
