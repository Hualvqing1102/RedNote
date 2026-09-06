import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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
  });

  it("编辑正文并保存修改", async () => {
    vi.mocked(api.updateNote).mockResolvedValue({ ...NOTE, content: "新写的正文" });
    render(<NoteView />);
    await screen.findByText("Transformer 笔记");

    fireEvent.click(screen.getByRole("button", { name: "编辑" }));
    const editor = screen.getByLabelText("笔记正文编辑区");
    fireEvent.change(editor, { target: { value: "新写的正文" } });
    fireEvent.click(screen.getByRole("button", { name: "保存修改" }));

    await waitFor(() => expect(api.updateNote).toHaveBeenCalledWith(1, { content: "新写的正文" }));
    expect(await screen.findByText("新写的正文")).toBeInTheDocument();
  });

  it("对笔记追问并展示回答", async () => {
    vi.mocked(api.ask).mockResolvedValue({ answer: "这是针对问题的回答" });
    render(<NoteView />);
    await screen.findByText("Transformer 笔记");

    fireEvent.change(screen.getByLabelText("输入问题"), {
      target: { value: "核心结论是什么？" },
    });
    fireEvent.click(screen.getByLabelText("发送"));

    await waitFor(() => expect(api.ask).toHaveBeenCalledWith(1, "核心结论是什么？"));
    expect(await screen.findByText("这是针对问题的回答")).toBeInTheDocument();
  });
});
