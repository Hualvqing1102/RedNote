"""跨会话导入助手(scripts/rednote_import.py)测试。"""
from __future__ import annotations

from scripts import rednote_import


def test_import_via_cli_main(tmp_path, monkeypatch):
    monkeypatch.setenv("REDNOTE_DATA_DIR", str(tmp_path / "data"))
    md = tmp_path / "note.md"
    md.write_text("# 讲解\n\n正文内容。", encoding="utf-8")

    rc = rednote_import.main(
        [
            "--title", "跨会话导入",
            "--summary", "摘要",
            "--point", "要点A",
            "--source-url", "https://example.com/x",
            "--content-file", str(md),
        ]
    )
    assert rc == 0

    from app.services import notes as svc

    db = tmp_path / "data" / "rednote.db"
    found = svc.list_notes(db, q="跨会话")
    assert len(found) == 1
    note = found[0]
    assert note["summary"] == "摘要"
    assert note["points"] == ["要点A"]
    assert note["source_url"] == "https://example.com/x"


def test_import_empty_content_rejected(tmp_path, monkeypatch, capsys):
    monkeypatch.setenv("REDNOTE_DATA_DIR", str(tmp_path / "data"))
    rc = rednote_import.main(["--title", "空"])
    assert rc == 2
    assert "正文为空" in capsys.readouterr().err
