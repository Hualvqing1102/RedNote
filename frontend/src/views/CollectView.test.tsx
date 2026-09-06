import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../api/client";
import { useAppStore } from "../store/useAppStore";
import CollectView from "./CollectView";
import type { SettingsResponse } from "../types";

vi.mock("../api/client", () => ({
  api: {
    getSettings: vi.fn(),
    collectUrl: vi.fn(),
    collectFile: vi.fn(),
    summarize: vi.fn(),
    explain: vi.fn(),
    createNote: vi.fn(),
    updateNote: vi.fn(),
    deleteNote: vi.fn(),
    ask: vi.fn(),
  },
}));

const MOCK_ENGINE: SettingsResponse = {
  settings: {
    provider: "mock",
    claude: { model: "m", has_key: false },
    openai: { base_url: "https://api.deepseek.com/v1", model: "deepseek-chat", has_key: false },
    deepseek: { base_url: "https://api.deepseek.com", model: "deepseek-chat", has_key: false },
    qwen: { base_url: "https://dashscope.aliyuncs.com/compatible-mode/v1", model: "qwen-plus", has_key: false },
  },
  active: { provider: "mock", available: true },
};

describe("CollectView", () => {
  beforeEach(() => {
    useAppStore.setState({ view: "collect", activeNoteId: null });
    vi.mocked(api.getSettings).mockReset().mockResolvedValue(MOCK_ENGINE);
    vi.mocked(api.collectUrl).mockReset();
    vi.mocked(api.collectFile).mockReset();
    vi.mocked(api.summarize).mockReset();
    vi.mocked(api.explain).mockReset();
    vi.mocked(api.createNote).mockReset();
  });

  it("空链接点击提炼给出校验提示", async () => {
    render(<CollectView />);
    fireEvent.click(screen.getByRole("button", { name: "提炼" }));
    expect(await screen.findByText("请先粘贴一个网页链接")).toBeInTheDocument();
    expect(api.collectUrl).not.toHaveBeenCalled();
  });

  it("完整采集→提炼→保存流程会调用接口并跳转笔记库", async () => {
    vi.mocked(api.collectUrl).mockResolvedValue({
      title: "Transformer 讲解",
      content: "注意力机制是核心。\n\n第二段正文。",
      source_url: "https://example.com/a",
    });
    vi.mocked(api.summarize).mockResolvedValue({
      title: "Transformer 讲解",
      summary: "这是一段摘要",
      points: ["要点一"],
    });
    vi.mocked(api.createNote).mockResolvedValue({
      id: 7,
      title: "Transformer 讲解",
      summary: "这是一段摘要",
      content: "注意力机制是核心。\n\n第二段正文。",
      points: ["要点一"],
      source_url: "https://example.com/a",
      source_snapshot: "x",
      folder_id: null,
      created_at: 1700000000,
      updated_at: 1700000000,
    });

    render(<CollectView />);
    fireEvent.change(screen.getByLabelText("网页链接"), {
      target: { value: "https://example.com/a" },
    });
    fireEvent.click(screen.getByRole("button", { name: "提炼" }));

    const saveBtn = await screen.findByRole("button", { name: "保存为笔记" });
    expect(api.collectUrl).toHaveBeenCalledWith("https://example.com/a");
    expect(api.summarize).toHaveBeenCalled();
    expect(screen.getByText("这是一段摘要")).toBeInTheDocument();
    expect(screen.getByText("要点一")).toBeInTheDocument();

    fireEvent.click(saveBtn);
    await waitFor(() => {
      expect(api.createNote).toHaveBeenCalled();
      expect(useAppStore.getState().view).toBe("library");
    });
  });

  it("选择本地 PDF/DOCX 文件后走提炼流程并可保存", async () => {
    vi.mocked(api.collectFile).mockResolvedValue({
      title: "attention_paper",
      content: "Attention is all you need.\n\nSelf-attention enables parallelization.",
      source_url: "",
      filename: "attention_paper.pdf",
    });
    vi.mocked(api.summarize).mockResolvedValue({
      title: "attention_paper",
      summary: "文件摘要",
      points: ["要点一"],
    });
    const { container } = render(<CollectView />);
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(["paper content"], "attention_paper.pdf", { type: "application/pdf" });

    fireEvent.change(input, { target: { files: [file] } });

    const saveBtn = await screen.findByRole("button", { name: "保存为笔记" });
    expect(api.collectFile).toHaveBeenCalledWith(file);
    expect(api.summarize).toHaveBeenCalled();
    expect(screen.getByText("文件摘要")).toBeInTheDocument();

    fireEvent.click(saveBtn);
    await waitFor(() => {
      expect(api.createNote).toHaveBeenCalled();
      expect(useAppStore.getState().view).toBe("library");
    });
  });

  it("PDF 提取可一键 OCR 重新识别", async () => {
    vi.mocked(api.collectFile).mockResolvedValue({
      title: "paper",
      content: "OCR 版正文",
      source_url: "",
      filename: "paper.pdf",
    });
    vi.mocked(api.summarize).mockResolvedValue({ title: "paper", summary: "s", points: [] });
    const { container } = render(<CollectView />);
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(["x"], "paper.pdf", { type: "application/pdf" });

    fireEvent.change(input, { target: { files: [file] } });
    await screen.findByRole("button", { name: "保存为笔记" });

    fireEvent.click(screen.getByRole("button", { name: /OCR 重新识别/ }));
    await waitFor(() => {
      expect(api.collectFile).toHaveBeenLastCalledWith(file, true);
    });
  });

  it("不支持的文件类型直接提示，不发请求", async () => {
    const { container } = render(<CollectView />);
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(["old"], "paper.doc", { type: "application/msword" });

    fireEvent.change(input, { target: { files: [file] } });

    expect(await screen.findByText(/暂不支持/)).toBeInTheDocument();
    expect(api.collectFile).not.toHaveBeenCalled();
  });

  it("引擎为云端 Claude 时给出隐私警示文案", async () => {
    vi.mocked(api.getSettings).mockResolvedValue({
      settings: {
        provider: "claude",
        claude: { model: "m", has_key: true },
        openai: { base_url: "https://api.deepseek.com/v1", model: "m", has_key: false },
        deepseek: { base_url: "https://api.deepseek.com", model: "deepseek-chat", has_key: false },
        qwen: { base_url: "https://dashscope.aliyuncs.com/compatible-mode/v1", model: "qwen-plus", has_key: false },
      },
      active: { provider: "claude", available: true },
    });
    vi.mocked(api.collectUrl).mockResolvedValue({
      title: "t",
      content: "正文",
      source_url: "https://example.com/a",
    });
    vi.mocked(api.summarize).mockResolvedValue({ title: "t", summary: "s", points: [] });

    render(<CollectView />);
    fireEvent.change(screen.getByLabelText("网页链接"), {
      target: { value: "https://example.com/a" },
    });
    fireEvent.click(screen.getByRole("button", { name: "提炼" }));

    expect(await screen.findByText(/正文会发送到 Anthropic 处理/)).toBeInTheDocument();
    await screen.findByRole("button", { name: "保存为笔记" });
  });

  it("详细讲解模式：不保存原文，正文保存为 AI 讲解", async () => {
    vi.mocked(api.collectUrl).mockResolvedValue({
      title: "T",
      content: "原文第一段。\n\n原文第二段。",
      source_url: "https://example.com/a",
    });
    vi.mocked(api.summarize).mockResolvedValue({ title: "T", summary: "摘要", points: ["要点"] });
    vi.mocked(api.explain).mockResolvedValue({
      title: "T",
      explanation: "# 详细讲解\n\n第一段讲的是…（讲解内容）",
    });

    render(<CollectView />);
    fireEvent.click(screen.getByRole("checkbox", { name: /详细讲解模式/ }));
    fireEvent.change(screen.getByLabelText("网页链接"), {
      target: { value: "https://example.com/a" },
    });
    fireEvent.click(screen.getByRole("button", { name: "提炼" }));

    // 预览左侧显示“详细讲解”正文，而不是原文
    expect(await screen.findByRole("heading", { name: "详细讲解" })).toBeInTheDocument();
    expect(screen.getByText(/讲解内容/)).toBeInTheDocument();
    expect(api.explain).toHaveBeenCalledWith("T", "原文第一段。\n\n原文第二段。");

    fireEvent.click(screen.getByRole("button", { name: "保存为笔记" }));
    await waitFor(() => {
      expect(api.createNote).toHaveBeenCalledWith(
        expect.objectContaining({
          content: "# 详细讲解\n\n第一段讲的是…（讲解内容）",
          source_snapshot: "",
        })
      );
    });
  });
});
