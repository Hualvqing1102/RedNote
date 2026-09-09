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
    uploadAttachment: vi.fn(),
    deleteAttachment: vi.fn(),
  },
}));

function mkNote(over: Partial<Note> = {}): Note {
  return {
    id: 1,
    title: "Transformer 笔记",
    summary: "AI 摘要",
    content: "注意力机制是核心。\n\n这是正文。",
    points: ["要点一"],
    comments: [],
    source_url: "",
    source_snapshot: "",
    folder_id: null,
    files: [],
    created_at: 1700000000,
    updated_at: 1700000000,
    ...over,
  };
}

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

describe("NoteView 手改字段 / 空白笔记 / 附件", () => {
  beforeEach(() => {
    useAppStore.setState({ view: "note", activeNoteId: 1 });
    vi.mocked(api.getSettings).mockReset().mockResolvedValue(ENGINE);
    vi.mocked(api.listFolders).mockReset().mockResolvedValue([]);
    vi.mocked(api.getNote).mockReset().mockResolvedValue(mkNote());
    vi.mocked(api.updateNote).mockReset().mockImplementation((id, patch) =>
      Promise.resolve(mkNote({ ...(patch as Partial<Note>) }))
    );
    vi.mocked(api.ask).mockReset();
    vi.mocked(api.deleteNote).mockReset();
    vi.mocked(api.uploadAttachment).mockReset();
    vi.mocked(api.deleteAttachment).mockReset();
  });

  it("编辑时修改标题/摘要/要点并保存", async () => {
    render(<NoteView />);
    await screen.findByText("Transformer 笔记");
    fireEvent.click(screen.getByRole("button", { name: "编辑" }));

    fireEvent.change(screen.getByLabelText("笔记标题"), { target: { value: "改名笔记" } });
    fireEvent.change(screen.getByLabelText("笔记摘要"), { target: { value: "手写摘要" } });
    fireEvent.change(screen.getByLabelText("要点1"), { target: { value: "手写要点一" } });
    fireEvent.click(screen.getByRole("button", { name: "＋ 添加要点" }));
    const second = await screen.findByLabelText("要点2");
    fireEvent.change(second, { target: { value: "手写要点二" } });
    fireEvent.click(screen.getByRole("button", { name: "保存修改" }));

    await waitFor(() =>
      expect(api.updateNote).toHaveBeenCalledWith(
        1,
        expect.objectContaining({
          title: "改名笔记",
          summary: "手写摘要",
          points: ["手写要点一", "手写要点二"],
        })
      )
    );
  });

  it("空白笔记打开后直接进入编辑态", async () => {
    vi.mocked(api.getNote).mockResolvedValue(mkNote({ title: "无标题", summary: "", content: "", points: [] }));
    render(<NoteView />);
    // 不需要点“编辑”，直接就出现标题/正文编辑框
    expect(await screen.findByLabelText("笔记标题")).toBeInTheDocument();
    expect(screen.getByLabelText("笔记摘要")).toBeInTheDocument();
    expect(screen.getByLabelText("笔记正文编辑区")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "编辑" })).not.toBeInTheDocument();
  });

  it("上传附件后列表展示，可删除", async () => {
    vi.mocked(api.uploadAttachment).mockResolvedValue(
      mkNote({ files: [{ id: "tok123", name: "paper.pdf", size: 100, added_at: 1700000000 }] })
    );
    render(<NoteView />);
    await screen.findByText("Transformer 笔记");

    const fileInput = screen.getByLabelText("添加附件") as HTMLInputElement;
    const file = new File(["x"], "paper.pdf", { type: "application/pdf" });
    fireEvent.change(fileInput, { target: { files: [file] } });

    await waitFor(() => expect(api.uploadAttachment).toHaveBeenCalledWith(1, file));
    const link = await screen.findByRole("link", { name: "paper.pdf" });
    expect(link.getAttribute("href")).toBe("/api/notes/1/files/tok123");

    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    fireEvent.click(screen.getByRole("button", { name: "删除附件paper.pdf" }));
    await waitFor(() => expect(api.deleteAttachment).toHaveBeenCalledWith(1, "tok123"));
    confirmSpy.mockRestore();
  });
});
