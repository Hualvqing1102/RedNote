import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../api/client";
import LibraryView from "./LibraryView";
import type { Note } from "../types";

vi.mock("../api/client", () => ({
  api: {
    listNotes: vi.fn(),
    listTags: vi.fn(),
    deleteNote: vi.fn(),
  },
}));

const NOTE: Note = {
  id: 1,
  title: "Transformer 笔记",
  summary: "测试摘要",
  content: "正文",
  points: ["要点一", "要点二"],
  source_url: "https://example.com/n",
  source_snapshot: "x",
  created_at: 1700000000,
  updated_at: 1700000000,
  tags: ["AI", "深度学习"],
};

describe("LibraryView", () => {
  beforeEach(() => {
    vi.mocked(api.listNotes).mockReset().mockResolvedValue([NOTE]);
    vi.mocked(api.listTags).mockReset().mockResolvedValue(["AI", "深度学习"]);
    vi.mocked(api.deleteNote).mockReset().mockResolvedValue(undefined);
  });

  it("渲染笔记卡片与导出入口", async () => {
    render(<LibraryView />);
    expect(await screen.findByText("Transformer 笔记")).toBeInTheDocument();
    expect(screen.getByText("2 要点")).toBeInTheDocument();
    const exportLink = screen.getByRole("link", { name: /导出全部 Markdown/ });
    expect(exportLink.getAttribute("href")).toBe("/api/export/notes.md");
  });

  it("空列表显示空态", async () => {
    vi.mocked(api.listNotes).mockResolvedValue([]);
    render(<LibraryView />);
    expect(await screen.findByText("没有匹配的笔记")).toBeInTheDocument();
  });

  it("删除需确认并调用接口", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<LibraryView />);
    await screen.findByText("Transformer 笔记");

    fireEvent.click(screen.getByTitle("删除笔记"));
    await waitFor(() => expect(api.deleteNote).toHaveBeenCalledWith(1));
    expect(confirmSpy).toHaveBeenCalled();

    // 删除成功后卡片消失
    await waitFor(() =>
      expect(screen.queryByText("Transformer 笔记")).not.toBeInTheDocument()
    );
    confirmSpy.mockRestore();
  });

  it("取消确认则不删除", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<LibraryView />);
    await screen.findByText("Transformer 笔记");

    fireEvent.click(screen.getByTitle("删除笔记"));
    expect(api.deleteNote).not.toHaveBeenCalled();
  });
});
