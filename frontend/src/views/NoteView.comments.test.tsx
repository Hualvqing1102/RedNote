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
      { id: "c1", text: "这里的比喻不错", links: [{ title: "原始论文", url: "https://arxiv.org/a" }], anchor: 0 },
      { id: "c2", text: "需要补充阅读", links: [], anchor: 1 },
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

describe("NoteView 内联注释(编辑/确认)", () => {
  beforeEach(() => {
    useAppStore.setState({ view: "note", activeNoteId: 1 });
    vi.mocked(api.getNote).mockReset().mockImplementation((id) => Promise.resolve(NOTES[id]));
    vi.mocked(api.getSettings).mockReset().mockResolvedValue(ENGINE);
    vi.mocked(api.updateNote).mockReset().mockImplementation((id, patch) => {
      const updated: Note = { ...NOTES[id], comments: patch.comments as CommentCard[] };
      return Promise.resolve(updated);
    });
    vi.mocked(api.ask).mockReset();
    vi.mocked(api.deleteNote).mockReset();
  });

  it("已确认注释以摘要卡片样式内联展示，可再编辑", async () => {
    render(<NoteView />);
    expect(await screen.findByText("第 1 段批注")).toBeInTheDocument();
    expect(screen.getByText("第 2 段批注")).toBeInTheDocument();
    // 阅读样式：正文以段落展示，输入框默认隐藏
    expect(screen.getByText("这里的比喻不错")).toBeInTheDocument();
    expect(screen.queryByLabelText("注释1正文")).not.toBeInTheDocument();
    // 点击“编辑”回到输入态
    fireEvent.click(screen.getByRole("button", { name: "编辑注释1" }));
    expect(screen.getByLabelText("注释1正文")).toHaveValue("这里的比喻不错");
    expect(screen.getByLabelText("注释1链接1标题")).toHaveValue("原始论文");
    // 底部不应再出现“添加注释卡片”按钮
    expect(screen.queryByRole("button", { name: "＋ 添加注释卡片" })).not.toBeInTheDocument();
  });

  it("右键任意段落可插入注释并自动保存", async () => {
    render(<NoteView />);
    const firstPara = await screen.findByText("第一段正文。");

    fireEvent.contextMenu(firstPara);
    expect(screen.getByRole("button", { name: "在此段后插入注释" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "在此段后插入注释" }));
    // 新卡片自动进入编辑态
    expect(screen.getByLabelText("注释3正文")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("注释3正文"), {
      target: { value: "新插入的批注内容" },
    });

    await waitFor(
      () => {
        expect(api.updateNote).toHaveBeenCalledWith(
          1,
          expect.objectContaining({
            comments: expect.arrayContaining([
              expect.objectContaining({ text: "新插入的批注内容", anchor: 0 }),
            ]),
          })
        );
      },
      { timeout: 4000 }
    );
  });

  it("点“确认”保存后切回阅读样式", async () => {
    render(<NoteView />);
    await screen.findByText("第 1 段批注");

    fireEvent.click(screen.getByRole("button", { name: "编辑注释1" }));
    fireEvent.change(screen.getByLabelText("注释1正文"), { target: { value: "已修改的批注" } });
    fireEvent.click(screen.getByRole("button", { name: "确认注释1" }));

    // 立即持久化
    await waitFor(
      () => {
        expect(api.updateNote).toHaveBeenCalledWith(
          1,
          expect.objectContaining({
            comments: expect.arrayContaining([
              expect.objectContaining({ id: "c1", text: "已修改的批注" }),
            ]),
          })
        );
      },
      { timeout: 4000 }
    );
    // 回到阅读样式：输入框消失，文本以段落展示
    expect(screen.queryByLabelText("注释1正文")).not.toBeInTheDocument();
    expect(screen.getByText("已修改的批注")).toBeInTheDocument();
  });

  it("可在编辑卡片中添加相关链接", async () => {
    render(<NoteView />);
    await screen.findByText("第 2 段批注");

    fireEvent.click(screen.getByRole("button", { name: "编辑注释2" }));
    fireEvent.click(screen.getAllByRole("button", { name: "＋ 添加相关链接" })[0]);
    fireEvent.change(screen.getByLabelText("注释2链接1地址"), {
      target: { value: "https://example.com/ref" },
    });
    fireEvent.change(screen.getByLabelText("注释2链接1标题"), {
      target: { value: "延伸阅读" },
    });

    await waitFor(
      () => {
        const called = vi.mocked(api.updateNote).mock.calls.some(
          ([, patch]) =>
            (patch.comments ?? []).some(
              (c) => c.id === "c2" && c.links.some((l) => l.url === "https://example.com/ref")
            )
        );
        expect(called).toBe(true);
      },
      { timeout: 4000 }
    );
  });

  it("删除已确认注释", async () => {
    render(<NoteView />);
    await screen.findByText("第 1 段批注");

    fireEvent.click(screen.getByRole("button", { name: "删除注释1" }));
    expect(screen.queryByText("这里的比喻不错")).not.toBeInTheDocument();
    expect(screen.queryByText("第 1 段批注")).not.toBeInTheDocument();

    await waitFor(
      () => {
        const calls = vi.mocked(api.updateNote).mock.calls;
        const last = calls[calls.length - 1];
        expect((last?.[1].comments ?? []).some((c: CommentCard) => c.id === "c1")).toBe(false);
      },
      { timeout: 4000 }
    );
  });

  it("无注释笔记显示引导提示(无文末按钮)", async () => {
    useAppStore.setState({ activeNoteId: 2 });
    render(<NoteView />);
    expect(await screen.findByText(/右键点击正文任意段落/)).toBeInTheDocument();
  });
});
