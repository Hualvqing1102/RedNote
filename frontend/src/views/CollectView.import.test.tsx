import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../api/client";
import { useAppStore } from "../store/useAppStore";
import CollectView from "./CollectView";
import type { Note } from "../types";

vi.mock("../api/client", () => ({
  api: {
    importAgent: vi.fn(),
    uploadAttachment: vi.fn(),
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

describe("CollectView 从 Agent 导入", () => {
  beforeEach(() => {
    useAppStore.setState({ view: "collect", activeNoteId: null });
    vi.mocked(api.importAgent).mockReset().mockResolvedValue(note(5));
    vi.mocked(api.uploadAttachment).mockReset().mockResolvedValue(note(5));
  });

  it("展开表单，粘贴讲解正文与来源后保存并跳转笔记库", async () => {
    render(<CollectView />);
    fireEvent.click(screen.getByRole("button", { name: "从 Agent 导入讲解 / 总结" }));

    fireEvent.change(screen.getByLabelText("导入标题"), { target: { value: "上下文工程讲解" } });
    fireEvent.change(screen.getByLabelText("导入来源网址"), {
      target: { value: "https://www.anthropic.com/engineering/effective-context-engineering" },
    });
    fireEvent.change(screen.getByLabelText("导入来源名称"), {
      target: { value: "Anthropic 官方文章" },
    });
    fireEvent.change(screen.getByLabelText("导入摘要"), { target: { value: "把上下文当工程设计" } });
    fireEvent.change(screen.getByLabelText("导入要点"), { target: { value: "要点一\n要点二" } });
    fireEvent.change(screen.getByLabelText("导入正文"), { target: { value: "# 讲解\n\n正文内容。" } });

    fireEvent.click(screen.getByRole("button", { name: "保存到笔记" }));

    await waitFor(() => {
      expect(api.importAgent).toHaveBeenCalledWith({
        title: "上下文工程讲解",
        summary: "把上下文当工程设计",
        points: ["要点一", "要点二"],
        content: "# 讲解\n\n正文内容。",
        source_url: "https://www.anthropic.com/engineering/effective-context-engineering",
        source_name: "Anthropic 官方文章",
      });
      expect(api.uploadAttachment).not.toHaveBeenCalled();
      expect(useAppStore.getState().view).toBe("library");
    });
  });

  it("选原文件时保存后作为附件归档", async () => {
    render(<CollectView />);
    fireEvent.click(screen.getByRole("button", { name: "从 Agent 导入讲解 / 总结" }));
    fireEvent.change(screen.getByLabelText("导入正文"), { target: { value: "讲解正文" } });

    const fileInput = screen.getByLabelText("导入原文件") as HTMLInputElement;
    const file = new File(["x"], "paper.pdf", { type: "application/pdf" });
    fireEvent.change(fileInput, { target: { files: [file] } });

    fireEvent.click(screen.getByRole("button", { name: "保存到笔记" }));

    await waitFor(() => expect(api.uploadAttachment).toHaveBeenCalledWith(5, file));
  });

  it("正文为空时提示", async () => {
    render(<CollectView />);
    fireEvent.click(screen.getByRole("button", { name: "从 Agent 导入讲解 / 总结" }));
    fireEvent.click(screen.getByRole("button", { name: "保存到笔记" }));
    expect(await screen.findByText("请填写讲解/总结正文")).toBeInTheDocument();
    expect(api.importAgent).not.toHaveBeenCalled();
  });
});
