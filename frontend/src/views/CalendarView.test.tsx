import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../api/client";
import CalendarView from "./CalendarView";
import type { EventItem } from "../types";

vi.mock("../api/client", () => ({
  api: {
    listEvents: vi.fn(),
    createEvent: vi.fn(),
    updateEvent: vi.fn(),
    deleteEvent: vi.fn(),
  },
}));

function startOfToday(): number {
  const d = new Date();
  return Math.floor(new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() / 1000);
}

function makeEvent(over: Partial<EventItem> = {}): EventItem {
  return {
    id: 1,
    title: "周会",
    kind: "schedule",
    color: "blue",
    start_ts: startOfToday() + 3600,
    end_ts: startOfToday() + 7200,
    all_day: false,
    done: false,
    note_id: null,
    created_at: startOfToday(),
    updated_at: startOfToday(),
    ...over,
  };
}

describe("CalendarView", () => {
  beforeEach(() => {
    vi.mocked(api.listEvents).mockReset().mockResolvedValue([makeEvent()]);
    vi.mocked(api.createEvent).mockReset().mockImplementation((input) =>
      Promise.resolve(makeEvent({ title: input.title, kind: input.kind, start_ts: input.start_ts, color: input.color ?? "green" }))
    );
    vi.mocked(api.updateEvent).mockReset().mockImplementation((id, patch) =>
      Promise.resolve(makeEvent({ ...patch, id }))
    );
    vi.mocked(api.deleteEvent).mockReset().mockResolvedValue(undefined);
  });

  it("月视图格子只显示便签标题，点击打开右侧面板", async () => {
    render(<CalendarView />);
    expect(await screen.findByText("周会")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "周会" }));
    expect(await screen.findByText("编辑")).toBeInTheDocument();
  });

  it("右侧面板新建待办并调用创建接口", async () => {
    render(<CalendarView />);
    await screen.findByText("周会");

    fireEvent.click(screen.getByRole("button", { name: "＋ 新建" }));
    fireEvent.click(screen.getByRole("button", { name: "待办" }));
    fireEvent.change(screen.getByLabelText("标题"), { target: { value: "交周报" } });
    fireEvent.click(screen.getByRole("button", { name: "添加到当日" }));

    await waitFor(() => {
      expect(api.createEvent).toHaveBeenCalledWith(
        expect.objectContaining({ title: "交周报", kind: "todo", color: "green", done: false })
      );
    });
  });

  it("右侧面板编辑已有事项", async () => {
    render(<CalendarView />);
    const chip = await screen.findByText("周会");
    fireEvent.click(chip);

    const editor = screen.getByLabelText("标题");
    fireEvent.change(editor, { target: { value: "周会(改)" } });
    fireEvent.click(screen.getByRole("button", { name: "保存修改" }));

    await waitFor(() => {
      expect(api.updateEvent).toHaveBeenCalledWith(1, expect.objectContaining({ title: "周会(改)" }));
    });
  });

  it("可切换周视图", async () => {
    render(<CalendarView />);
    await screen.findByText("周会");
    fireEvent.click(screen.getByRole("button", { name: "周" }));
    expect(await screen.findByText("周会")).toBeInTheDocument();
  });

  it("周视图同一时间段的日程分配泳道、左右挤排显示", async () => {
    const a = makeEvent({ id: 1, title: "会议A", start_ts: startOfToday() + 3600, end_ts: startOfToday() + 7200 });
    const b = makeEvent({ id: 2, title: "会议B", start_ts: startOfToday() + 5400, end_ts: startOfToday() + 7200 });
    vi.mocked(api.listEvents).mockReset().mockResolvedValue([a, b]);
    const { container } = render(<CalendarView />);
    await screen.findByText("会议A");
    fireEvent.click(screen.getByRole("button", { name: "周" }));

    const blocks = () => Array.from(container.querySelectorAll(".ev-block")) as HTMLElement[];
    await waitFor(() => expect(blocks().length).toBe(2));
    const widths = blocks().map((el) => el.style.width);
    expect(widths).toEqual(["calc(50% - 6px)", "calc(50% - 6px)"]);
  });

  it("周视图点击时间栏即预填该时间新建日程", async () => {
    render(<CalendarView />);
    await screen.findByText("周会");
    fireEvent.click(screen.getByRole("button", { name: "周" }));
    const grid = document.querySelectorAll(".week-gridlines")[0] as HTMLElement;
    fireEvent.click(grid, { clientY: 90 });
    const start = await screen.findByLabelText("开始时间");
    expect((start as HTMLInputElement).value).toBe("03:00");
  });
});
