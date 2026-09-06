import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../api/client";
import type { EventColor, EventInput, EventItem, EventKind, EventRecur } from "../types";

const WEEK_LABELS = ["一", "二", "三", "四", "五", "六", "日"];
export const EVENT_COLORS: { id: EventColor; label: string }[] = [
  { id: "green", label: "绿" },
  { id: "blue", label: "蓝" },
  { id: "yellow", label: "黄" },
  { id: "pink", label: "粉" },
  { id: "purple", label: "紫" },
];
const PX_PER_HOUR = 30;

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
function timeOf(d: Date): string {
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function tsToDate(ts: number): Date {
  return new Date(ts * 1000);
}

/** 同一天内、时间重叠的日程“竖着排开”：后一个整体向下错开，保证都可见、不互相覆盖。 */
function layoutStack(timed: EventItem[]): { item: EventItem; top: number; height: number }[] {
  const rows = timed.map((ev) => {
    const t = tsToDate(ev.start_ts);
    const mins = t.getHours() * 60 + t.getMinutes();
    const endMins = ev.end_ts
      ? (() => { const e = tsToDate(ev.end_ts); return e.getHours() * 60 + e.getMinutes(); })()
      : mins + 60;
    const height = Math.max(44, ((endMins - mins) / 60) * PX_PER_HOUR);
    return { ev, mins, height };
  });
  rows.sort((a, b) => a.mins - b.mins || a.ev.start_ts - b.ev.start_ts);
  let bottom = 0;
  return rows.map((r) => {
    const naturalTop = (r.mins / 60) * PX_PER_HOUR;
    const top = Math.max(naturalTop, bottom + 2);
    bottom = top + r.height;
    return { item: r.ev, top, height: r.height };
  });
}
function fmtDayTitle(d: Date): string {
  const weeks = ["日", "一", "二", "三", "四", "五", "六"];
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 · 周${weeks[d.getDay()]}`;
}

interface FormState {
  title: string;
  kind: EventKind;
  color: EventColor;
  recur: EventRecur;
  allDay: boolean;
  startTime: string;
  endTime: string;
  done: boolean;
}
type CalMode = "month" | "week";

function blankForm(): FormState {
  return { title: "", kind: "schedule", color: "green", recur: "none", allDay: false, startTime: "09:00", endTime: "10:00", done: false };
}
function formFromEvent(ev: EventItem): FormState {
  const d = tsToDate(ev.start_ts);
  return {
    title: ev.title,
    kind: ev.kind,
    color: ev.color,
    recur: ev.recur,
    allDay: ev.all_day,
    startTime: timeOf(d),
    endTime: ev.end_ts ? timeOf(tsToDate(ev.end_ts)) : "",
    done: ev.done,
  };
}
function formToInput(f: FormState, day: Date): EventInput {
  const [y, m, dayN] = [day.getFullYear(), day.getMonth(), day.getDate()];
  const localTs = (d: Date) => Math.floor(d.getTime() / 1000);
  let start = epoch(day); // 全天/待办：当天 00:00
  let end: number | undefined;
  if (f.kind === "schedule" && !f.allDay) {
    const [hh, mm] = f.startTime.split(":").map(Number);
    start = localTs(new Date(y, m, dayN, hh, mm));
    if (f.endTime) {
      const [eh, em] = f.endTime.split(":").map(Number);
      end = localTs(new Date(y, m, dayN, eh, em));
    }
  }
  return {
    title: f.title.trim(),
    kind: f.kind,
    color: f.color,
    recur: f.recur,
    start_ts: start,
    end_ts: f.kind === "todo" || f.allDay ? null : end ?? null,
    all_day: f.kind === "todo" || f.allDay,
    done: f.done,
  };
}

export default function CalendarView() {
  const [mode, setMode] = useState<CalMode>("month");
  const [anchor, setAnchor] = useState<Date>(startOfDay(new Date()));
  const [events, setEvents] = useState<EventItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  // 右侧面板：openDay 非空时显示
  const [openDay, setOpenDay] = useState<Date | null>(null);
  const [form, setForm] = useState<FormState>(blankForm());
  const [editingId, setEditingId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);

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
      list.sort((a, b) => {
        if (a.done !== b.done) return a.done ? 1 : -1;
        return a.start_ts - b.start_ts;
      });
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
  function openDayDrawer(date: Date, event?: EventItem, prefillTime?: string) {
    setOpenDay(date);
    if (event) {
      setForm(formFromEvent(event));
    } else {
      const base = blankForm();
      if (prefillTime) {
        const [hh, mm] = prefillTime.split(":").map(Number);
        const end = mm + 60 >= 60 ? pad((hh + 1) % 24) + ":" + pad(mm) : prefillTime;
        base.startTime = prefillTime;
        base.endTime = end;
        base.kind = "schedule";
        base.allDay = false;
      }
      setForm(base);
    }
    setEditingId(event?.id ?? null);
  }

  function openNewAt(date: Date, clientY: number, el: HTMLElement) {
    const rect = el.getBoundingClientRect();
    const y = clientY - rect.top;
    const mins = Math.max(0, Math.min(23 * 60 + 55, Math.round((y / PX_PER_HOUR) * 60 / 5) * 5));
    const hh = Math.floor(mins / 60);
    const mm = mins % 60;
    openDayDrawer(date, undefined, `${pad(hh)}:${pad(mm)}`);
  }

  function resetFormFor(date: Date) {
    setOpenDay(date);
    setEditingId(null);
    setForm(blankForm());
    setError("");
  }

  async function saveForm() {
    if (!openDay) return;
    if (!form.title.trim()) {
      setError("请填写标题");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const input = formToInput(form, openDay);
      if (editingId !== null) await api.updateEvent(editingId, input);
      else await api.createEvent(input);
      setEditingId(null);
      setForm(blankForm());
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
      setEditingId(null);
      setForm(blankForm());
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "删除失败");
    }
  }

  async function toggleDone(ev: EventItem) {
    try {
      await api.updateEvent(ev.id, { done: !ev.done });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "操作失败");
    }
  }

  const openItems = openDay ? (byDay.get(dateKey(openDay)) ?? []) : [];
  const weekNo = useMemo(() => {
    const mon = mondayOf(anchor);
    const jan1 = new Date(mon.getFullYear(), 0, 1);
    const offset = (jan1.getDay() + 6) % 7;
    return Math.ceil((Math.floor((mon.getTime() - jan1.getTime()) / 86400000) + offset + 1) / 7);
  }, [anchor]);
  const title =
    mode === "month"
      ? `${anchor.getFullYear()} 年 ${anchor.getMonth() + 1} 月`
      : `${anchor.getFullYear()} 年 · 第 ${weekNo} 周`;

  return (
    <div className={`calendar-wrap${openDay ? " with-drawer" : ""}`}>
      <div className="cal-layout">
        <div className="cal-main">
          <div className="cal-toolbar">
            <div className="cal-title">{title}</div>
            <div className="cal-nav">
              <button className="btn btn-ghost btn-sm" onClick={() => nav(-1)} aria-label="上一页">‹</button>
              <button className="btn btn-ghost btn-sm" onClick={() => setAnchor(startOfDay(new Date()))}>今天</button>
              <button className="btn btn-ghost btn-sm" onClick={() => nav(1)} aria-label="下一页">›</button>
            </div>
            <div className="cal-modes" role="group" aria-label="视图切换">
              <button className={`cal-mode${mode === "month" ? " active" : ""}`} onClick={() => setMode("month")}>月</button>
              <button className={`cal-mode${mode === "week" ? " active" : ""}`} onClick={() => setMode("week")}>周</button>
            </div>
          </div>

          {error && <div className="error-banner" role="alert">{error}</div>}
          {loading && <div className="hint">加载中…</div>}

          {mode === "month" ? (
            <div className="cal-month">
              <div className="cal-weekhead">
                {WEEK_LABELS.map((w) => <span className="week-head-cell" key={w}>周{w}</span>)}
              </div>
              {Array.from({ length: 6 }, (_, w) => (
                <div className="cal-row" key={w}>
                  {cells.slice(w * 7, w * 7 + 7).map((d, i) => {
                    const key = dateKey(d);
                    const items = byDay.get(key) ?? [];
                    const inMonth = d.getMonth() === anchor.getMonth();
                    const isToday = key === dateKey(new Date());
                    return (
                      <div
                        key={i}
                        className={`cal-cell${inMonth ? "" : " muted"}${isToday ? " today" : ""}`}
                        onClick={() => resetFormFor(d)}
                      >
                        <span className="cell-date">{d.getDate()}</span>
                        <div className="cell-items">
                          {items.slice(0, 3).map((ev) => (
                            <button
                              key={ev.id}
                              className={`cell-item ev-${ev.color}${ev.done ? " done" : ""}`}
                              title={ev.title}
                              onClick={(e) => {
                                e.stopPropagation();
                                openDayDrawer(d, ev);
                              }}
                            >
                              {ev.title}
                            </button>
                          ))}
                          {items.length > 3 && <span className="cell-more">+{items.length - 3}</span>}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          ) : (
            <div className="cal-week">
              <div className="week-axis">
                {Array.from({ length: 24 }, (_, h) => h % 3 === 0 ? <span key={h} style={{ top: 34 + h * PX_PER_HOUR - 7 }}>{pad(h)}:00</span> : null)}
              </div>
              {cells.map((d, i) => {
                const key = dateKey(d);
                const items = byDay.get(key) ?? [];
                const timed = items.filter((ev) => ev.kind === "schedule" && !ev.all_day);
                const others = items.filter((ev) => !(ev.kind === "schedule" && !ev.all_day));
                const stacked = layoutStack(timed);
                return (
                  <div
                    key={i}
                    className={`week-col${key === dateKey(new Date()) ? " today" : ""}`}
                    onClick={() => resetFormFor(d)}
                  >
                    <div className="week-col-head"><span>{WEEK_LABELS[i]}</span></div>
                    <div
                      className="week-gridlines"
                      onClick={(e) => { e.stopPropagation(); openNewAt(d, e.clientY, e.currentTarget); }}
                    >
                      {others.map((ev) => (
                        <button
                          key={ev.id}
                          className={`ev-pinned ev-${ev.color}${ev.done ? " done" : ""}`}
                          onClick={(e) => { e.stopPropagation(); openDayDrawer(d, ev); }}
                        >
                          {ev.title}
                        </button>
                      ))}
                      {stacked.map(({ item: ev, top, height }) => {
                        const t = tsToDate(ev.start_ts);
                        return (
                          <button
                            key={ev.id}
                            className={`ev-block ev-${ev.color}${ev.done ? " done" : ""}`}
                            style={{ top, height, left: 4, width: "calc(100% - 8px)" }}
                            onClick={(e) => { e.stopPropagation(); openDayDrawer(d, ev); }}
                          >
                            <span className="ev-time">{timeOf(t)}</span>
                            {ev.title}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {openDay && (
          <aside className="cal-drawer">
            <div className="drawer-head">
              <div className="drawer-title">{fmtDayTitle(openDay)}</div>
              <button className="drawer-close" aria-label="关闭面板" onClick={() => setOpenDay(null)}>×</button>
            </div>

            {error && <div className="error-banner" role="alert">{error}</div>}

            <div className="drawer-list">
              {openItems.length === 0 && <div className="empty small">当天还没有事项</div>}
              {openItems.map((ev) => (
                <div className={`drawer-item ev-${ev.color}${ev.done ? " done" : ""}`} key={ev.id}>
                  <input
                    type="checkbox"
                    checked={ev.done}
                    aria-label={`完成${ev.title}`}
                    onChange={() => toggleDone(ev)}
                  />
                  <div className="di-body" onClick={() => openDayDrawer(openDay, ev)}>
                    <div className="di-title">{ev.title}</div>
                    <div className="di-sub">
                      {ev.kind === "schedule" ? "日程" : "待办"}
                      {!ev.all_day && ev.kind === "schedule" && ` · ${timeOf(tsToDate(ev.start_ts))}`}
                    </div>
                  </div>
                  <button className="di-del" aria-label={`删除${ev.title}`} onClick={() => removeEvent(ev.id)}>删除</button>
                </div>
              ))}
            </div>

            <div className="drawer-form">
              <div className="drawer-form-title">{editingId !== null ? "编辑" : "＋ 新建便签"}</div>
              <div className="kind-tabs">
                {([["schedule", "日程"], ["todo", "待办"]] as const).map(([val, label]) => (
                  <button key={val} className={`kind-tab${form.kind === val ? " active" : ""}`}
                    onClick={() => setForm({ ...form, kind: val, allDay: val === "todo" })}>
                    {label}
                  </button>
                ))}
              </div>
              <label className="field-row"><span>标题</span>
                <input type="text" value={form.title} placeholder="想记点什么…" aria-label="标题"
                  onChange={(e) => setForm({ ...form, title: e.target.value })} />
              </label>

              <div className="field-row"><span>颜色</span>
                <div className="swatches">
                  {EVENT_COLORS.map((c) => (
                    <button key={c.id} type="button" aria-label={`颜色${c.label}`} title={c.label}
                      className={`swatch ev-${c.id}${form.color === c.id ? " active" : ""}`}
                      onClick={() => setForm({ ...form, color: c.id })} />
                  ))}
                </div>
              </div>

              <div className="field-row"><span>每周</span>
                <button type="button"
                  className={`btn btn-sm btn-recur${form.recur === "weekly" ? " btn-toggle-on" : ""}`}
                  onClick={() => setForm({ ...form, recur: form.recur === "weekly" ? "none" : "weekly" })}>
                  {form.recur === "weekly" ? "每周重复 ✓" : "设为每周待办"}
                </button>
              </div>

              {form.kind === "schedule" && (
                <label className="field-row inline"><span>全天</span>
                  <input type="checkbox" checked={form.allDay} onChange={(e) => setForm({ ...form, allDay: e.target.checked })} />
                </label>
              )}
              {form.kind === "schedule" && !form.allDay && (
                <>
                  <label className="field-row"><span>开始</span>
                    <input type="time" value={form.startTime} aria-label="开始时间"
                      onChange={(e) => setForm({ ...form, startTime: e.target.value })} />
                  </label>
                  <label className="field-row"><span>结束</span>
                    <input type="time" value={form.endTime} aria-label="结束时间"
                      onChange={(e) => setForm({ ...form, endTime: e.target.value })} />
                  </label>
                </>
              )}

              {editingId !== null && (
                <label className="field-row inline"><span>完成</span>
                  <input type="checkbox" checked={form.done} onChange={(e) => setForm({ ...form, done: e.target.checked })} />
                </label>
              )}

              <div className="drawer-actions">
                <button className="btn btn-primary" onClick={saveForm} disabled={saving}>
                  {saving ? "保存中…" : editingId !== null ? "保存修改" : "添加到当日"}
                </button>
                {editingId !== null && (
                  <button className="btn btn-ghost danger" onClick={() => removeEvent(editingId)}>删除</button>
                )}
              </div>
            </div>
          </aside>
        )}
      </div>
    </div>
  );
}
