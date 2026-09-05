import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../api/client";
import { useAppStore } from "../store/useAppStore";
import NoteView from "./NoteView";
import type { Note, SettingsResponse } from "../types";

vi.mock("../api/client", () => ({
  api: {
    getNote: vi.fn(),
    getSettings: vi.fn(),
    listFolders: vi.fn(),
    updateNote: vi.fn(),
    ask: vi.fn(),
    deleteNote: vi.fn(),
  },
}));

const NOTE: Note = {
  id: 1,
  title: "带章节的笔记",
  summary: "摘要",
  content: "# 第一章 概述\n\n这是第一段正文。\n\n## 1.1 小节\n\n小节内容。\n\n## 1.2 小节\n\n更多内容。",
  points: [],
  comments: [],
  source_url: "",
  source_snapshot: "",
  created_at: 1700000000,
  updated_at: 1700000000,
  folder_id: null,
};

const ENGINE: SettingsResponse = {
  settings: {
    provider: "mock",
    claude: { model: "m", has_key: false },
    openai: { base_url: "https://api.deepseek.com/v1", model: "deepseek-chat", has_key: false },
  },
  active: { provider: "mock", available: true },
};

describe("NoteView 阅读工具", () => {
  beforeEach(() => {
    useAppStore.setState({ view: "note", activeNoteId: 1 });
    localStorage.clear();
    vi.mocked(api.getNote).mockReset().mockResolvedValue(NOTE);
    vi.mocked(api.getSettings).mockReset().mockResolvedValue(ENGINE);
    vi.mocked(api.listFolders).mockReset().mockResolvedValue([]);
    vi.mocked(api.updateNote).mockReset().mockResolvedValue(NOTE);
    vi.mocked(api.ask).mockReset();
    vi.mocked(api.deleteNote).mockReset();
  });

  it("字号按钮会改变阅读倍率", async () => {
    render(<NoteView />);
    const container = (await screen.findByTestId("reader-article")) as HTMLElement;
    expect(container.style.getPropertyValue("--reader-scale")).toBe("1");

    fireEvent.click(screen.getByRole("button", { name: "增大字号" }));
    expect(container.style.getPropertyValue("--reader-scale")).toBe("1.1");

    fireEvent.click(screen.getByRole("button", { name: "减小字号" }));
    expect(container.style.getPropertyValue("--reader-scale")).toBe("1");
  });

  it("有标题时目录以独立左栏出现", async () => {
    render(<NoteView />);
    const reader = (await screen.findByTestId("reader-article")) as HTMLElement;
    const layout = reader.closest(".note-layout") as HTMLElement | null;
    expect(layout?.classList.contains("has-outline")).toBe(true);

    const nav = screen.getByRole("complementary", { name: "文章目录" });
    expect(within(nav).getByText("第一章 概述")).toBeInTheDocument();
    expect(within(nav).getByText("1.1 小节")).toBeInTheDocument();
    expect(within(nav).getByText("1.2 小节")).toBeInTheDocument();

    // 点击目录项应定位到对应标题(jsdom 无 scrollIntoView，只验证不抛错)
    expect(() => fireEvent.click(within(nav).getByText("1.1 小节"))).not.toThrow();
  });

  it("无标题笔记不显示目录栏", async () => {
    vi.mocked(api.getNote).mockResolvedValue({
      ...NOTE,
      content: "只有普通正文，没有任何标题。",
    });
    render(<NoteView />);
    await screen.findByTestId("reader-article");
    expect(screen.queryByRole("complementary", { name: "文章目录" })).not.toBeInTheDocument();
  });
});
