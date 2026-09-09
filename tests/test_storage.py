"""数据存储位置(自选目录/迁移/锚点)服务与接口测试。"""
from __future__ import annotations

from app.services import storage as svc


def test_migrate_copies_and_keeps_source(tmp_path, monkeypatch):
    src = tmp_path / "src"
    dst = tmp_path / "dst"
    monkeypatch.setenv("REDNOTE_DATA_DIR", str(src))
    monkeypatch.setenv("REDNOTE_DATA_DIR_ANCHOR", str(tmp_path / "anchor"))
    src.mkdir(parents=True)
    (src / "rednote.db").write_bytes(b"db-bytes")
    (src / "settings.json").write_text("{}", encoding="utf-8")
    att = src / "attachments" / "1"
    att.mkdir(parents=True)
    (att / "a.pdf").write_bytes(b"pdf")

    res = svc.migrate_to(str(dst))
    assert res["moved"] == ["rednote.db", "settings.json", "attachments"]
    assert (dst / "rednote.db").read_bytes() == b"db-bytes"
    assert (dst / "settings.json").read_text(encoding="utf-8") == "{}"
    assert (dst / "attachments" / "1" / "a.pdf").read_bytes() == b"pdf"
    # 原文件不删除(安全)
    assert (src / "rednote.db").exists()


def test_location_pointer_roundtrip(tmp_path, monkeypatch):
    monkeypatch.setenv("REDNOTE_DATA_DIR_ANCHOR", str(tmp_path / "anchor"))
    target = (tmp_path / "mynotes").resolve()
    svc.write_location(target)
    assert svc.read_location() == target
    svc.clear_location()
    assert svc.read_location() is None


def test_migrate_rejects_same_or_relative(tmp_path, monkeypatch):
    src = tmp_path / "src"
    src.mkdir(parents=True)
    monkeypatch.setenv("REDNOTE_DATA_DIR", str(src))
    monkeypatch.setenv("REDNOTE_DATA_DIR_ANCHOR", str(tmp_path / "anchor"))
    try:
        svc.migrate_to(str(src))
        raise AssertionError("应当拒绝相同路径")
    except ValueError as exc:
        assert "相同" in str(exc)
    try:
        svc.migrate_to("some/relative")
        raise AssertionError("应当拒绝相对路径")
    except ValueError as exc:
        assert "绝对路径" in str(exc)


def test_storage_endpoints(client, tmp_path, monkeypatch):
    src = tmp_path / "appdata"
    src.mkdir(parents=True)
    (src / "rednote.db").write_bytes(b"db")
    monkeypatch.setenv("REDNOTE_DATA_DIR", str(src))
    monkeypatch.setenv("REDNOTE_DATA_DIR_ANCHOR", str(tmp_path / "anchor"))

    got = client.get("/api/settings/storage")
    assert got.status_code == 200
    assert got.json()["dir"] == str(src)

    dst = tmp_path / "chosen"
    put = client.put("/api/settings/storage", json={"path": str(dst)})
    assert put.status_code == 200
    body = put.json()
    assert body["restart"] is True
    assert "rednote.db" in body["moved"]
    # 锚点文件记录新位置
    assert (tmp_path / "anchor" / "data_location.txt").read_text(encoding="utf-8").strip() == str(dst.resolve())

    reset = client.delete("/api/settings/storage")
    assert reset.status_code == 200
    assert not (tmp_path / "anchor" / "data_location.txt").exists()

    bad = client.put("/api/settings/storage", json={"path": str(src)})
    assert bad.status_code == 400
