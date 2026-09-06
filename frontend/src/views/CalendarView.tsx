import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../api/client";
import type { EventInput, EventItem, EventKind } from "../types";

const WEEK_LABELS = ["一", "二", "三", "四", "五", "六", "日"];
const pad = (n: number) => String(n).padStart(2, "0");

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}
function addDays(d: Date, n: number): Date {
  const c = startOfDay(d);
  c.setDate(c.getDate() + n);
  return c;
}
function addMonths(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth() + n, 1);
}
function mondayOf(d: Date): Date {
  const dow = (d.getDay() + 6) % 7;
  return addDays(d, -dow);
}
function epoch(d: Date): number {
  return Math.floor(startOfDay(d).getTime() / 1000);
}
function dateKey(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function dateInput(d: Date): string {
  return dateKey(d);
}
function timeOf(d: Date): string {
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function tsToDate(ts: number): Date {
  return new Date(ts * 1000);
}
function fmtRange(ts: number): string {
  const d = tsToDate(ts);
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}

interface DraftState {
  date: string;
  kind: EventKind;
  title: string;
  allDay: boolean;
  startTime: string;
  endTime: string;
  done: boolean;
}

type CalMode = "month" | "week";

function buildDraft(date: Date): DraftState {
  return {
    date: dateInput(date),
    kind: "schedule",
    title: "",
    allDay: false,
    startTime: "09:00",
    endTime: "10:00",
    done: false,
  };
}

function draftToInput(d: DraftState, base: number | null): EventInput {
  const [y, m, day] = d.date.split("-").map(Number);
  const dayStart = new Date(y, m - 1, day);
  let start = epoch(dayStart);
  if (d.kind === "schedule" && !d.allDay) {
    const [h, min] = d.startTime.split(":").map(Number);
    start = epoch(new Date(y, m - 1, day, h, min));
  }
  const input: EventInput = {
    title: d.title.trim(),
    kind: d.kind,
    start_ts: start,
    all_day: d.allDay || d.kind === "todo",
    done: d.done,
  };
  if (d.kind === "schedule" && !d.allDay && d.endTime && d.endTime >= d.startTime) {
    const [eh, emin] = d.endTime.split(":").map(Number);
    input.end_ts = epoch(new Date(y, m - 1, day, eh, emin));
  }
  void base;
  return input;
}

export default function CalendarView() {
  const [mode, setMode] = useState<CalMode>("month");
  const [anchor, setAnchor] = useState<Date>(startOfDay(new Date()));
  const [events, setEvents] = useState<EventItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [draft, setDraft] = useState<DraftState | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);

  const todayKey = dateKey(new Date());

  const cells = useMemo(() => {
    if (mode === "month") {
      const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
      const start = addDays(first, -((first.getDay() + 6) % 7));
      return Array.from({ length: 42 }, (_, i) => addDays(start, i));
    }
    const mon = mondayOf(anchor);
    return Array.from({ length: 7 }, (_, i) => addDays(mon, i));
  }, [mode, anchor]);

  const byDay = useMemo(() => {
    const map = new Map<string, EventItem[]>();
    for (const ev of events) {
      const k = dateKey(tsToDate(ev.start_ts));
      const list = map.get(k) ?? [];
      list.push(ev);
      map.set(k, list);
    }
    for (const list of map.values()) {
      list.sort((a, b) => (a.done === b.done ? a.start_ts - b.start_ts : a.done ? 1 : -1));
    }
    return map;
  }, [events]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const start = epoch(cells[0]);
      const end = epoch(addDays(cells[cells.length - 1], 1));
      const list = await api.listEvents(start, end);
      setEvents(list);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, [cells]);

  useEffect(() => {
    load();
  }, [load]);

  function nav(dir: number) {
    setAnchor((a) => (mode === "month" ? addMonths(a, dir) : addDays(a, dir * 7)));
  }

  function openCreate(date: Date) {
    setEditingId(null);
    setDraft(buildDraft(date));
  }

  function openEdit(ev: EventItem) {
    const d = tsToDate(ev.start_ts);
    const draftState: DraftState = {
      date: dateInput(d),
      kind: ev.kind,
      title: ev.title,
      allDay: ev.all_day,
      startTime: timeOf(d),
      endTime: ev.end_ts ? timeOf(tsToDate(ev.end_ts)) : "",
      done: ev.done,
    };
    if (ev.kind === "todo") draftState.allDay = true;
    setEditingId(ev.id);
    setDraft(draftState);
  }

  async function save() {
    if (!draft) return;
    if (!draft.title.trim()) {
      setError("请填写标题");
      return;
    }
    setSaving(true);
    setError("");
    try {
      if (editingId !== null) {
        await api.updateEvent(editingId, draftToInput(draft, editingId));
      } else {
        await api.createEvent(draftToInput(draft, null));
      }
      setDraft(null);
      setEditingId(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存失败");
    } finally {
      setSaving(false);
    }
  }

  async function removeEvent(id: number) {
    if (!window.confirm("确定删除这条事项吗？")) return;
    try {
      await api.deleteEvent(id);
      setDraft(null);
      setEditingId(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "删除失败");
    }
  }

  const title =
    mode === "month"
      ? `${anchor.getFullYear()} 年 ${anchor.getMonth() + 1} 月`
      : `${fmtRange(epoch(cells[0]))} – ${fmtRange(epoch(cells[cells.length - 1]))}`;

  const draftDate = draft ? new Date(`${draft.date}T00:00:00`) : null;

  return (
    <div className="calendar-wrap">
      <div className="cal-toolbar">
        <div className="cal-title">{title}</div>
        <div className="cal-nav">
          <button className="btn btn-ghost btn-sm" onClick={() => nav(-1)} aria-label="上一页">
            ‹
          </button>
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => setAnchor(startOfDay(new Date()))}
          >
            今天
          </button>
          <button className="btn btn-ghost btn-sm" onClick={() => nav(1)} aria-label="下一页">
            ›
          </button>
        </div>
        <div className="cal-modes" role="group" aria-label="视图切换">
          <button
            className={`cal-mode${mode === "month" ? " active" : ""}`}
            onClick={() => setMode("month")}
          >
            月
          </button>
          <button
            className={`cal-mode${mode === "week" ? " active" : ""}`}
            onClick={() => setMode("week")}
          >
            周
          </button>
        </div>
        <button className="btn btn-primary btn-sm" onClick={() => openCreate(new Date())}>
          ＋ 新建
        </button>
      </div>

      {error && (
        <div className="error-banner" role="alert">
          {error}
        </div>
      )}
      {loading && <div className="hint">加载中…</div>}

      <div className={`cal-grid cal-${mode}`}>
        <div className="cal-weekhead">
          <span className="week-label">周</span>
          {cells.slice(0, 7).map((d, i) => (
            <button
              key={i}
              className={`week-head${dateKey(d) === todayKey ? " today" : ""}`}
              onClick={() => openCreate(d)}
              title="点击添加当天事项"
            >
              <span className="wn">{WEEK_LABELS[i]}</span>
              <span className="wd">{d.getDate()}</span>
            </button>
          ))}
        </div>

        {mode === "month"
          ? Array.from({ length: 6 }, (_, w) => (
              <div className="cal-row" key={w}>
                {cells.slice(w * 7, w * 7 + 7).map((d, i) => {
                  const key = dateKey(d);
                  const items = byDay.get(key) ?? [];
                  const inMonth = d.getMonth() === anchor.getMonth();
                  return (
                    <div
                      key={i}
                      className={`cal-cell${inMonth ? "" : " muted"}${key === todayKey ? " today" : ""}`}
                      onClick={() => openCreate(d)}
                    >
                      <span className="cell-date">{d.getDate()}</span>
                      <div className="cell-items">
                        {items.slice(0, 3).map((ev) => (
                          <button
                            key={ev.id}
                            className={`cell-item ${ev.kind}${ev.done ? " done" : ""}`}
                            title={ev.title}
                            onClick={(e) => {
                              e.stopPropagation();
                              openEdit(ev);
                            }}
                          >
                            {ev.title}
                          </button>
                        ))}
                        {items.length > 3 && <span className="cell-more">+{items.length - 3} 项</span>}
                      </div>
                    </div>
                  );
                })}
              </div>
            ))
          : cells.map((d, i) => {
              const key = dateKey(d);
              const items = byDay.get(key) ?? [];
              return (
                <div
                  key={i}
                  className={`cal-week-col${key === todayKey ? " today" : ""}`}
                  onClick={() => openCreate(d)}
                >
                  <div className="week-col-head">
                    <span className="wn">{WEEK_LABELS[i]}</span>
                    <span className="wd">{d.getDate()}</span>
                  </div>
                  <div className="week-col-items">
                    {items.map((ev) => (
                      <button
                        key={ev.id}
                        className={`cell-item ${ev.kind}${ev.done ? " done" : ""}`}
                        title={ev.title}
                        onClick={(e) => {
                          e.stopPropagation();
                          openEdit(ev);
                        }}
                      >
                        {ev.kind === "schedule" && !ev.all_day && (
                          <span className="ev-time">{timeOf(tsToDate(ev.start_ts))}</span>
                        )}
                        {ev.title}
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
      </div>

      {draft && (
        <div className="modal-backdrop" onMouseDown={() => setDraft(null)}>
          <div className="modal card" role="dialog" aria-modal="true" onMouseDown={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <span className="lbl">{editingId !== null ? "编辑事项" : "新建事项"}</span>
              <button className="modal-close" aria-label="关闭" onClick={() => setDraft(null)}>
                ×
              </button>
            </div>
            <div className="modal-body">
              <div className="kind-tabs">
                {(
                  [
                    ["schedule", "日程"],
                    ["todo", "待办"],
                  ] as const
                ).map(([val, label]) => (
                  <button
                    key={val}
                    className={`kind-tab${draft.kind === val ? " active" : ""}`}
                    onClick={() => setDraft({ ...draft, kind: val, allDay: val === "todo" ? true : draft.allDay })}
                  >
                    {label}
                  </button>
                ))}
              </div>

              <label className="field-row">
                <span>标题</span>
                <input
                  type="text"
                  value={draft.title}
                  placeholder="例如：与导师讨论方案"
                  aria-label="标题"
                  autoFocus
                  onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                />
              </label>

              <label className="field-row">
                <span>日期</span>
                <input
                  type="date"
                  value={draft.date}
                  aria-label="日期"
                  onChange={(e) => setDraft({ ...draft, date: e.target.value })}
                />
              </label>

              {draft.kind === "schedule" && (
                <>
                  <label className="field-row inline">
                    <span>全天</span>
                    <input
                      type="checkbox"
                      checked={draft.allDay}
                      onChange={(e) => setDraft({ ...draft, allDay: e.target.checked })}
                    />
                  </label>
                  {!draft.allDay && (
                    <>
                      <label className="field-row">
                        <span>开始</span>
                        <input
                          type="time"
                          value={draft.startTime}
                          aria-label="开始时间"
                          onChange={(e) => setDraft({ ...draft, startTime: e.target.value })}
                        />
                      </label>
                      <label className="field-row">
                        <span>结束</span>
                        <input
                          type="time"
                          value={draft.endTime}
                          aria-label="结束时间"
                          onChange={(e) => setDraft({ ...draft, endTime: e.target.value })}
                        />
                      </label>
                    </>
                  )}
                </>
              )}

              {draftDate && draft.kind === "todo" && (
                <div className="date-hint">待办已设为：{draftDate.getMonth() + 1}月{draftDate.getDate()}日</div>
              )}

              {editingId !== null && (
                <label className="field-row inline">
                  <span>完成</span>
                  <input
                    type="checkbox"
                    checked={draft.done}
                    onChange={(e) => setDraft({ ...draft, done: e.target.checked })}
                  />
                </label>
              )}
            </div>
            <div className="modal-actions">
              {editingId !== null && (
                <button className="btn btn-ghost danger" onClick={() => removeEvent(editingId)}>
                  删除
                </button>
              )}
              <span className="spacer" />
              <button className="btn btn-ghost" onClick={() => setDraft(null)}>
                取消
              </button>
              <button className="btn btn-primary" onClick={save} disabled={saving}>
                {saving ? "保存中…" : "保存"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
