import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../api/client";
import { useAppStore } from "../store/useAppStore";
import NoteView from "./NoteView";
import type { CommentCard, Note, SettingsResponse } from "../types";

vi.mock("../api/client", () => ({
  api: {
    getNote: vi.fn(),
    getSettings: vi.fn(),
    updateNote: vi.fn(),
    ask: vi.fn(),
    deleteNote: vi.fn(),
  },
}));

const NOTES: Record<number, Note> = {
  1: {
    id: 1,
    title: "Transformer 笔记",
    summary: "关于注意力的总结",
    content: "第一段正文。\n\n第二段正文。",
    points: ["要点一"],
    comments: [
      { id: "c1", text: "这里的比喻不错", links: [{ title: "原始论文", url: "https://arxiv.org/a" }] },
      { id: "c2", text: "需要补充阅读", links: [] },
    ],
    source_url: "https://example.com/n",
    source_snapshot: "x",
    created_at: 1700000000,
    updated_at: 1700000000,
    tags: ["AI"],
  },
  2: {
    id: 2,
    title: "无注释笔记",
    summary: "",
    content: "只有正文。",
    points: [],
    comments: [],
    source_url: "",
    source_snapshot: "",
    created_at: 1700000000,
    updated_at: 1700000000,
    tags: [],
  },
};

const ENGINE: SettingsResponse = {
  settings: {
    provider: "mock",
    claude: { model: "m", has_key: false },
    openai: { base_url: "https://api.deepseek.com/v1", model: "deepseek-chat", has_key: false },
  },
  active: { provider: "mock", available: true },
};

describe("NoteView 注释面板", () => {
  beforeEach(() => {
    useAppStore.setState({ view: "note", activeNoteId: 1 });
    vi.mocked(api.getNote).mockReset().mockImplementation((id) => Promise.resolve(NOTES[id]));
    vi.mocked(api.getSettings).mockReset().mockResolvedValue(ENGINE);
    vi.mocked(api.updateNote).mockReset();
    vi.mocked(api.ask).mockReset();
    vi.mocked(api.deleteNote).mockReset();
  });

  it("展示已有注释卡片与相关链接", async () => {
    render(<NoteView />);
    expect(await screen.findByText("我的注释与相关链接")).toBeInTheDocument();
    expect(screen.getByText("这里的比喻不错")).toBeInTheDocument();
    expect(screen.getByLabelText("注释1链接1标题")).toHaveValue("原始论文");
    expect(screen.getByLabelText("注释1链接1地址")).toHaveValue("https://arxiv.org/a");
    expect(screen.getAllByLabelText(/注释\d+正文/)).toHaveLength(2);
  });

  it("新增卡片后可编辑并保存(随笔记持久化)", async () => {
    vi.mocked(api.updateNote).mockImplementation((id, patch) => {
      const updated: Note = { ...NOTES[id], comments: patch.comments as CommentCard[] };
      return Promise.resolve(updated);
    });
    render(<NoteView />);
    await screen.findByText("我的注释与相关链接");

    fireEvent.click(screen.getByRole("button", { name: "＋ 添加注释卡片" }));
    const editors = screen.getAllByLabelText(/注释\d+正文/);
    expect(editors).toHaveLength(3);
    fireEvent.change(editors[2], { target: { value: "新加的第三条注释" } });
    const addLinkButtons = screen.getAllByRole("button", { name: "＋ 添加相关链接" });
    expect(addLinkButtons).toHaveLength(3);
    fireEvent.click(addLinkButtons[2]); // 给第 3 张卡片加链接
    fireEvent.change(screen.getByLabelText("注释3链接1标题"), {
      target: { value: "参考链接" },
    });
    fireEvent.change(screen.getByLabelText("注释3链接1地址"), {
      target: { value: "https://deepwiki.com/x" },
    });

    fireEvent.click(screen.getByRole("button", { name: "保存注释" }));
    await waitFor(() => {
      expect(api.updateNote).toHaveBeenCalledWith(1, {
        comments: expect.arrayContaining([
          expect.objectContaining({ text: "新加的第三条注释" }),
        ]),
      });
    });
    expect(await screen.findByText("注释已保存")).toBeInTheDocument();
  });

  it("删除注释卡片", async () => {
    render(<NoteView />);
    await screen.findByText("我的注释与相关链接");
    expect(screen.getAllByLabelText(/注释\d+正文/)).toHaveLength(2);

    fireEvent.click(screen.getByRole("button", { name: "删除注释1" }));
    expect(screen.getAllByLabelText(/注释\d+正文/)).toHaveLength(1);
    expect(screen.queryByText("这里的比喻不错")).not.toBeInTheDocument();
    // 出现脏标记 → 可保存
    expect(screen.getByRole("button", { name: "保存注释" })).toBeInTheDocument();
  });

  it("上下移动改变卡片顺序", async () => {
    render(<NoteView />);
    await screen.findByText("我的注释与相关链接");

    fireEvent.click(screen.getByRole("button", { name: "下移注释1" }));
    // c2 应上移到第一位：其正文输入框变成注释1正文
    const firstEditor = screen.getByLabelText("注释1正文");
    expect((firstEditor as HTMLTextAreaElement).value).toBe("需要补充阅读");
  });

  it("无注释笔记展示空态", async () => {
    useAppStore.setState({ activeNoteId: 2 });
    render(<NoteView />);
    expect(await screen.findByText(/还没有注释/)).toBeInTheDocument();
  });
});
