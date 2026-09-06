"""日历事件(日程/待办)API 测试。"""
from __future__ import annotations

from datetime import datetime, timedelta

from app.services import events as svc


def _mk(client, title="周会", kind="schedule", start=1700000000, end=1700003600, all_day=False):
    return client.post(
        "/api/events",
        json={"title": title, "kind": kind, "start_ts": start, "end_ts": end, "all_day": all_day},
    )


def test_event_crud(client):
    resp = _mk(client)
    assert resp.status_code == 201
    eid = resp.json()["id"]
    assert resp.json()["title"] == "周会"
    assert resp.json()["kind"] == "schedule"

    # 更新标题与完成状态
    upd = client.patch(f"/api/events/{eid}", json={"title": "周会(改)", "done": True})
    assert upd.status_code == 200
    assert upd.json()["title"] == "周会(改)"
    assert upd.json()["done"] is True

    # 删除
    assert client.delete(f"/api/events/{eid}").status_code == 204
    assert client.patch("/api/events/99999", json={"title": "x"}).status_code == 404


def test_list_by_range_and_todo(client):
    _mk(client, title="A", start=1000, end=2000)
    _mk(client, title="B", kind="todo", start=1500, all_day=True)
    _mk(client, title="C", start=9000)

    items = client.get("/api/events", params={"start": 0, "end": 5000}).json()
    titles = [i["title"] for i in items]
    assert titles == ["A", "B"]
    assert items[1]["done"] is False and items[1]["kind"] == "todo"


def test_event_validation(client):
    assert client.post("/api/events", json={"title": "  ", "kind": "todo", "start_ts": 1}).status_code == 400
    assert client.post("/api/events", json={"title": "x", "kind": "note", "start_ts": 1}).status_code == 400
    resp = client.post("/api/events", json={"title": "x", "kind": "todo", "start_ts": 10, "end_ts": 5})
    assert resp.status_code == 400


def test_service_toggle_and_delete(db_path):
    e = svc.create_event(db_path, {"title": "todo1", "kind": "todo", "start_ts": 5})
    eid = e["id"]
    assert svc.update_event(db_path, eid, {"done": True})["done"] is True
    assert svc.delete_event(db_path, eid) is True
    assert svc.delete_event(db_path, eid) is False
    assert svc.get_event(db_path, eid) is None


def test_weekly_recur_appears_in_future_week(client):
    """每周重复的待办在下周仍会出现(不随周切换而消失)。"""
    today0 = datetime.now().replace(hour=0, minute=0, second=0, microsecond=0)
    base = int(today0.timestamp())
    r = client.post(
        "/api/events",
        json={"title": "每周打扫", "kind": "todo", "start_ts": base, "all_day": True, "recur": "weekly"},
    )
    assert r.status_code == 201
    assert r.json()["recur"] == "weekly"

    w1_end = int((today0 + timedelta(days=7)).timestamp())
    week1 = client.get("/api/events", params={"start": base, "end": w1_end}).json()
    assert any(e["title"] == "每周打扫" for e in week1)

    w2_start = int((today0 + timedelta(days=7)).timestamp())
    w2_end = int((today0 + timedelta(days=14)).timestamp())
    week2 = client.get("/api/events", params={"start": w2_start, "end": w2_end}).json()
    found = [e for e in week2 if e["title"] == "每周打扫"]
    assert found, "每周重复待办应在下一周继续出现"
    assert found[0]["start_ts"] == w2_start


def test_weekly_recur_does_not_appear_before_anchor(client):
    """锚点之前的周不应出现该每周待办。"""
    today0 = datetime.now().replace(hour=0, minute=0, second=0, microsecond=0)
    base = int(today0.timestamp())
    client.post(
        "/api/events",
        json={"title": "每周打扫", "kind": "todo", "start_ts": base, "all_day": True, "recur": "weekly"},
    )
    before = client.get("/api/events", params={"start": base - 14 * 86400, "end": base}).json()
    assert not any(e["title"] == "每周打扫" for e in before)
