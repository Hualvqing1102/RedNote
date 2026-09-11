import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../api/client";
import { useAppStore } from "../store/useAppStore";
import NoteView from "./NoteView";
import type { Note, SettingsResponse } from "../types";

type AnyWindow = Window & { pywebview?: unknown };

afterEach(() => {
  vi.restoreAllMocks();
  delete (window as AnyWindow).pywebview;
});

vi.mock("../api/client", () => ({
  api: {
    getNote: vi.fn(),
    getSettings: vi.fn(),
    listFolders: vi.fn(),
    listNotes: vi.fn(),
    updateNote: vi.fn(),
    ask: vi.fn(),
    deleteNote: vi.fn(),
  },
}));

const NOTE: Note = {
  id: 1,
  title: "Transformer 笔记",
  summary: "关于注意力的总结",
  content: "第一段正文。\n\n第二段正文。",
  points: ["要点一", "要点二"],
  source_url: "https://example.com/n",
  source_snapshot: "x",
  folder_id: null,
  created_at: 1700000000,
  updated_at: 1700000000,
};

const ENGINE: SettingsResponse = {
  settings: {
    provider: "mock",
    claude: { model: "m", has_key: false },
    openai: { base_url: "https://api.deepseek.com/v1", model: "deepseek-chat", has_key: false },
    deepseek: { base_url: "https://api.deepseek.com", model: "deepseek-chat", has_key: false },
    qwen: { base_url: "https://dashscope.aliyuncs.com/compatible-mode/v1", model: "qwen-plus", has_key: false },
  },
  active: { provider: "mock", available: true },
};

describe("NoteView", () => {
  beforeEach(() => {
    useAppStore.setState({ view: "note", activeNoteId: 1 });
    vi.mocked(api.getNote).mockReset().mockResolvedValue(NOTE);
    vi.mocked(api.getSettings).mockReset().mockResolvedValue(ENGINE);
    vi.mocked(api.listFolders).mockReset().mockResolvedValue([]);
    vi.mocked(api.listNotes).mockReset().mockResolvedValue([]);
    vi.mocked(api.updateNote).mockReset();
    vi.mocked(api.ask).mockReset();
    vi.mocked(api.deleteNote).mockReset();
  });

  it("展示标题、摘要与要点", async () => {
    render(<NoteView />);
    expect(await screen.findByText("Transformer 笔记")).toBeInTheDocument();
    expect(screen.getByText("关于注意力的总结")).toBeInTheDocument();
    expect(screen.getByText("要点一")).toBeInTheDocument();
    expect(screen.getByText("要点二")).toBeInTheDocument();
  });

  it("提供单篇 Markdown 导出链接", async () => {
    render(<NoteView />);
    await screen.findByText("Transformer 笔记");
    const link = screen.getByRole("link", { name: "导出 Markdown" });
    expect(link.getAttribute("href")).toBe("/api/notes/1/export.md");
    // 浏览器下载的文件名用笔记标题，不再是无从辨认的 note-1.md
    expect(link.getAttribute("download")).toBe("Transformer 笔记.md");
  });

  it("桌面版导出走原生「另存为」，文件名用笔记标题", async () => {
    const saveFile = vi.fn().mockResolvedValue({ ok: true, path: "H:\\下载\\笔记.md" });
    (window as AnyWindow).pywebview = { api: { save_file: saveFile } };
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(new Uint8Array([35]), { status: 200 })
    );

    render(<NoteView />);
    await screen.findByText("Transformer 笔记");
    fireEvent.click(screen.getByRole("link", { name: "导出 Markdown" }));

    await waitFor(() => expect(saveFile).toHaveBeenCalledTimes(1));
    expect(saveFile.mock.calls[0][0]).toBe("Transformer 笔记.md");
    expect(await screen.findByText(/已保存到 H:\\下载\\笔记\.md/)).toBeInTheDocument();
  });

  it("编辑正文并保存修改", async () => {
    vi.mocked(api.updateNote).mockResolvedValue({ ...NOTE, content: "新写的正文" });
    render(<NoteView />);
    await screen.findByText("Transformer 笔记");

    fireEvent.click(screen.getByRole("button", { name: "编辑" }));
    const editor = screen.getByLabelText("笔记正文编辑区");
    fireEvent.change(editor, { target: { value: "新写的正文" } });
    fireEvent.click(screen.getByRole("button", { name: "保存修改" }));

    await waitFor(() =>
      expect(api.updateNote).toHaveBeenCalledWith(
        1,
        expect.objectContaining({ content: "新写的正文", title: "Transformer 笔记" })
      )
    );
    expect(await screen.findByText("新写的正文")).toBeInTheDocument();
  });
});
