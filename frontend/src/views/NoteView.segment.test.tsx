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
    agentSegment: vi.fn(),
    deleteNote: vi.fn(),
  },
}));

const NOTE: Note = {
  id: 1,
  title: "Transformer 笔记",
  summary: "",
  content: "注意力机制让模型关注重要位置。\n\n这是 Transformer 的核心思想。",
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
    deepseek: { base_url: "https://api.deepseek.com", model: "deepseek-chat", has_key: false },
    qwen: { base_url: "https://dashscope.aliyuncs.com/compatible-mode/v1", model: "qwen-plus", has_key: false },
  },
  active: { provider: "mock", available: true },
};

function selectParagraph(text: string): HTMLElement {
  const node = screen.getByText(text);
  const target: Node = node.firstChild ?? node;
  const range = document.createRange();
  range.selectNodeContents(target);
  const sel = window.getSelection();
  sel?.removeAllRanges();
  sel?.addRange(range);
  fireEvent.mouseUp(node);
  return node;
}

describe("NoteView 选中段落 Agent 操作", () => {
  beforeEach(() => {
    useAppStore.setState({ view: "note", activeNoteId: 1 });
    vi.mocked(api.getNote).mockReset().mockResolvedValue(NOTE);
    vi.mocked(api.getSettings).mockReset().mockResolvedValue(ENGINE);
    vi.mocked(api.listFolders).mockReset().mockResolvedValue([]);
    vi.mocked(api.updateNote).mockReset().mockImplementation((id, patch) =>
      Promise.resolve({ ...NOTE, id, comments: patch.comments as never })
    );
    vi.mocked(api.ask).mockReset();
    vi.mocked(api.agentSegment).mockReset().mockResolvedValue({ answer: "这是针对该段的解释回答。" });
    vi.mocked(api.deleteNote).mockReset();
  });

  it("选中文本后弹出工具条并执行“解释这段”", async () => {
    render(<NoteView />);
    await screen.findByText("注意力机制让模型关注重要位置。");
    selectParagraph("注意力机制让模型关注重要位置。");

    const dialog = await screen.findByRole("dialog", { name: "选中段落操作" });
    expect(dialog).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "解释这段" }));

    await waitFor(() => {
      expect(api.agentSegment).toHaveBeenCalledWith(1, "注意力机制让模型关注重要位置。", "explain", "");
    });
    expect(await screen.findByText("这是针对该段的解释回答。")).toBeInTheDocument();
  });

  it("追问细节：输入问题回车后按 ask 调用", async () => {
    render(<NoteView />);
    await screen.findByText("注意力机制让模型关注重要位置。");
    selectParagraph("注意力机制让模型关注重要位置。");
    fireEvent.click(await screen.findByRole("button", { name: "追问细节" }));

    const input = await screen.findByLabelText("追问输入");
    fireEvent.change(input, { target: { value: "它有什么缺点？" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => {
      expect(api.agentSegment).toHaveBeenCalledWith(
        1,
        "注意力机制让模型关注重要位置。",
        "ask",
        "它有什么缺点？"
      );
    });
    expect(await screen.findByText("这是针对该段的解释回答。")).toBeInTheDocument();
  });

  it("可将回答存为该段注释并触发自动保存", async () => {
    render(<NoteView />);
    await screen.findByText("注意力机制让模型关注重要位置。");
    selectParagraph("注意力机制让模型关注重要位置。");
    fireEvent.click(await screen.findByRole("button", { name: "解释这段" }));
    await screen.findByText("这是针对该段的解释回答。");

    fireEvent.click(screen.getByRole("button", { name: "存为注释" }));

    await waitFor(
      () => {
        expect(api.updateNote).toHaveBeenCalledWith(
          1,
          expect.objectContaining({
            comments: expect.arrayContaining([
              expect.objectContaining({ text: "这是针对该段的解释回答。", anchor: 0 }),
            ]),
          })
        );
      },
      { timeout: 4000 }
    );
  });
});
