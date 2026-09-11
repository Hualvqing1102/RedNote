import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../api/client";
import LibraryView from "./LibraryView";
import type { Folder, Note } from "../types";

type AnyWindow = Window & { pywebview?: unknown };

afterEach(() => {
  vi.restoreAllMocks();
  delete (window as AnyWindow).pywebview;
});

vi.mock("../api/client", () => ({
  api: {
    listNotes: vi.fn(),
    listFolders: vi.fn(),
    deleteNote: vi.fn(),
    createFolder: vi.fn(),
    renameFolder: vi.fn(),
    deleteFolder: vi.fn(),
    updateNote: vi.fn(),
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
  folder_id: 10,
  folder_name: "AI",
  created_at: 1700000000,
  updated_at: 1700000000,
};

const FOLDERS: Folder[] = [
  { id: 10, name: "AI", note_count: 1 },
  { id: 11, name: "工程", note_count: 0 },
];

describe("LibraryView", () => {
  beforeEach(() => {
    vi.mocked(api.listNotes).mockReset().mockResolvedValue([NOTE]);
    vi.mocked(api.listFolders).mockReset().mockResolvedValue(FOLDERS);
    vi.mocked(api.deleteNote).mockReset().mockResolvedValue(undefined);
    vi.mocked(api.updateNote).mockReset();
    vi.mocked(api.createFolder).mockReset().mockResolvedValue({ id: 12, name: "新夹", note_count: 0 });
  });

  it("渲染收藏夹筛选与导出入口", async () => {
    render(<LibraryView />);
    expect(await screen.findByText("Transformer 笔记")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /AI/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /工程/ })).toBeInTheDocument();
    const exportLink = screen.getByRole("link", { name: /导出全部 Markdown/ });
    expect(exportLink.getAttribute("href")).toBe("/api/export/notes.md");
  });

  it("桌面版点击导出走原生「另存为」并回显保存路径", async () => {
    const saveFile = vi.fn().mockResolvedValue({ ok: true, path: "H:\\下载\\notes.md" });
    (window as AnyWindow).pywebview = { api: { save_file: saveFile } };
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(new Uint8Array([35, 32]), { status: 200 })
    );

    render(<LibraryView />);
    await screen.findByText("Transformer 笔记");
    fireEvent.click(screen.getByRole("link", { name: /导出全部 Markdown/ }));

    await waitFor(() => expect(saveFile).toHaveBeenCalledTimes(1));
    expect(saveFile.mock.calls[0][0]).toMatch(/^rednote-notes-\d{8}\.md$/);
    expect(await screen.findByText(/已保存到 H:\\下载\\notes\.md/)).toBeInTheDocument();
  });

  it("桌面版导出被取消时给出提示", async () => {
    const saveFile = vi.fn().mockResolvedValue({ ok: false, cancelled: true });
    (window as AnyWindow).pywebview = { api: { save_file: saveFile } };
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("x", { status: 200 }));

    render(<LibraryView />);
    await screen.findByText("Transformer 笔记");
    fireEvent.click(screen.getByRole("link", { name: /导出全部 Markdown/ }));

    expect(await screen.findByText("已取消保存")).toBeInTheDocument();
  });

  it("点击收藏夹后按 folder 过滤", async () => {
    render(<LibraryView />);
    await screen.findByText("Transformer 笔记");
    fireEvent.click(screen.getByRole("button", { name: /工程/ }));
    await waitFor(() => {
      expect(api.listNotes).toHaveBeenCalledWith({ q: undefined, folder: 11 });
    });
  });

  it("新建收藏夹", async () => {
    render(<LibraryView />);
    await screen.findByText("Transformer 笔记");
    fireEvent.click(screen.getByRole("button", { name: "＋ 新建收藏夹" }));
    fireEvent.change(screen.getByLabelText("新收藏夹名称"), { target: { value: "新夹" } });
    fireEvent.click(screen.getByRole("button", { name: "确定" }));
    await waitFor(() => expect(api.createFolder).toHaveBeenCalledWith("新夹"));
  });

  it("卡片下拉可直接把已有笔记移入收藏夹", async () => {
    vi.mocked(api.updateNote).mockReset().mockResolvedValue({ ...NOTE, folder_id: 11, folder_name: "工程" });
    render(<LibraryView />);
    await screen.findByText("Transformer 笔记");

    fireEvent.change(screen.getByLabelText("设置笔记「Transformer 笔记」的收藏夹"), {
      target: { value: "11" },
    });
    await waitFor(() => expect(api.updateNote).toHaveBeenCalledWith(1, { folder_id: 11 }));
    // 计数刷新(再次拉取收藏夹)
    expect(api.listFolders).toHaveBeenCalled();
  });

  it("管理模式下可两步确认删除收藏夹", async () => {
    render(<LibraryView />);
    await screen.findByText("Transformer 笔记");
    fireEvent.click(screen.getByRole("button", { name: "管理" }));
    fireEvent.click(screen.getByRole("button", { name: "删除收藏夹工程" }));
    fireEvent.click(screen.getByRole("button", { name: "确认删除" }));
    await waitFor(() => expect(api.deleteFolder).toHaveBeenCalledWith(11));
  });

  it("空列表显示空态", async () => {
    vi.mocked(api.listNotes).mockResolvedValue([]);
    render(<LibraryView />);
    await new Promise((r) => setTimeout(r, 50));
    expect(document.body.textContent ?? "").toContain("没有匹配的笔记");
  });

  it("删除笔记需两步确认并调用接口", async () => {
    render(<LibraryView />);
    await screen.findByText("Transformer 笔记");

    fireEvent.click(screen.getByRole("button", { name: "删除" }));
    // 原地变成“确认删除”，不再弹系统确认框
    fireEvent.click(screen.getByRole("button", { name: "确认删除" }));
    await waitFor(() => expect(api.deleteNote).toHaveBeenCalledWith(1));
    await waitFor(() =>
      expect(screen.queryByText("Transformer 笔记")).not.toBeInTheDocument()
    );
  });
});
