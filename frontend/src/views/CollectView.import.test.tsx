import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../api/client";
import { useAppStore } from "../store/useAppStore";
import CollectView from "./CollectView";
import type { Note } from "../types";

vi.mock("../api/client", () => ({
  api: {
    importAgent: vi.fn(),
  },
}));

function note(id = 5): Note {
  return {
    id,
    title: "导入的笔记",
    summary: "",
    content: "正文",
    points: [],
    comments: [],
    source_url: "",
    source_snapshot: "",
    folder_id: null,
    files: [],
    created_at: 1700000000,
    updated_at: 1700000000,
  };
}

describe("CollectView 拖入 Markdown 原样存档", () => {
  beforeEach(() => {
    useAppStore.setState({ view: "collect", activeNoteId: null });
    vi.mocked(api.importAgent).mockReset().mockResolvedValue(note(5));
  });

  it("拖入/选择 .md：按首个标题命名并原样保存(含表格)，跳转笔记库", async () => {
    render(<CollectView />);
    const input = screen.getByLabelText("选择本地文档") as HTMLInputElement;
    const md = "# 上下文工程讲解\n\n正文一段。\n\n| 列1 | 列2 |\n|---|---|\n| a | b |\n";
    const file = new File([md], "agent.md", { type: "text/markdown" });

    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => {
      expect(api.importAgent).toHaveBeenCalledWith({
        title: "上下文工程讲解",
        content: md.trim(),
        source_name: "agent.md",
      });
      expect(useAppStore.getState().view).toBe("library");
    });
  });

  it("无标题时用文件名作为标题", async () => {
    render(<CollectView />);
    const input = screen.getByLabelText("选择本地文档") as HTMLInputElement;
    const file = new File(["没有标题的正文"], "我的讲解.md", { type: "text/markdown" });

    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => {
      expect(api.importAgent).toHaveBeenCalledWith(
        expect.objectContaining({ title: "我的讲解", content: "没有标题的正文", source_name: "我的讲解.md" })
      );
    });
  });
});
