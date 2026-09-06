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
      Promise.resolve(makeEvent({ title: input.title, kind: input.kind, start_ts: input.start_ts }))
    );
    vi.mocked(api.updateEvent).mockReset().mockImplementation((id, patch) =>
      Promise.resolve(makeEvent({ ...patch, id }))
    );
    vi.mocked(api.deleteEvent).mockReset().mockResolvedValue(undefined);
  });

  it("渲染月视图并显示当天的事项", async () => {
    render(<CalendarView />);
    expect(await screen.findByText("周会")).toBeInTheDocument();
  });

  it("新建待办：填写标题保存后调用创建接口", async () => {
    render(<CalendarView />);
    await screen.findByText("周会");

    fireEvent.click(screen.getByRole("button", { name: "＋ 新建" }));
    fireEvent.click(screen.getByRole("button", { name: "待办" }));
    fireEvent.change(screen.getByLabelText("标题"), { target: { value: "交周报" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => {
      expect(api.createEvent).toHaveBeenCalledWith(
        expect.objectContaining({ title: "交周报", kind: "todo", done: false })
      );
    });
  });

  it("可切换到周视图", async () => {
    render(<CalendarView />);
    await screen.findByText("周会");
    fireEvent.click(screen.getByRole("button", { name: "周" }));
    // 周视图仍展示今天的事项
    expect(await screen.findByText("周会")).toBeInTheDocument();
  });

  it("点事项打开编辑并保存修改", async () => {
    render(<CalendarView />);
    const chip = await screen.findByText("周会");
    fireEvent.click(chip);

    const editor = screen.getByLabelText("标题");
    fireEvent.change(editor, { target: { value: "周会(改)" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => {
      expect(api.updateEvent).toHaveBeenCalledWith(1, expect.objectContaining({ title: "周会(改)" }));
    });
  });
});
