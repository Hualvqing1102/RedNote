import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "./api/client";
import App from "./App";
import type { Note } from "./types";

vi.mock("./api/client", () => ({
  api: {
    listNotes: vi.fn(),
    listFolders: vi.fn(),
  },
}));

const note: Note = {
  id: 1,
  title: "测试笔记标题",
  summary: "这是一条测试摘要",
  content: "正文内容。",
  points: ["要点一"],
  source_url: "https://example.com/note",
  source_snapshot: "快照",
  folder_id: null,
  created_at: 1700000000,
  updated_at: 1700000000,
};

describe("App", () => {
  beforeEach(() => {
    vi.mocked(api.listNotes).mockReset().mockResolvedValue([note]);
    vi.mocked(api.listFolders).mockReset().mockResolvedValue([]);
  });

  it("渲染侧栏品牌与采集页", () => {
    render(<App />);
    expect(screen.getByText("RedNote")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "采集" })).toBeInTheDocument();
    expect(screen.getByText("把网页里的知识，提炼成你自己的笔记")).toBeInTheDocument();
  });

  it("切到笔记库后加载并显示笔记", async () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "笔记库" }));
    // 列表接口应被调用，并渲染出笔记卡片
    expect(await screen.findByText("测试笔记标题")).toBeInTheDocument();
    expect(api.listNotes).toHaveBeenCalled();
  });
});
