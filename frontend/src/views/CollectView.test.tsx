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
    summarize: vi.fn(),
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
  },
  active: { provider: "mock", available: true },
};

describe("CollectView", () => {
  beforeEach(() => {
    useAppStore.setState({ view: "collect", activeNoteId: null });
    vi.mocked(api.getSettings).mockReset().mockResolvedValue(MOCK_ENGINE);
    vi.mocked(api.collectUrl).mockReset();
    vi.mocked(api.summarize).mockReset();
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
      tags: ["AI"],
    });
    vi.mocked(api.createNote).mockResolvedValue({
      id: 7,
      title: "Transformer 讲解",
      summary: "这是一段摘要",
      content: "注意力机制是核心。\n\n第二段正文。",
      points: ["要点一"],
      source_url: "https://example.com/a",
      source_snapshot: "x",
      created_at: 1700000000,
      updated_at: 1700000000,
      tags: ["AI"],
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

  it("引擎为云端 Claude 时给出隐私警示文案", async () => {
    vi.mocked(api.getSettings).mockResolvedValue({
      settings: {
        provider: "claude",
        claude: { model: "m", has_key: true },
        openai: { base_url: "https://api.deepseek.com/v1", model: "m", has_key: false },
      },
      active: { provider: "claude", available: true },
    });
    vi.mocked(api.collectUrl).mockResolvedValue({
      title: "t",
      content: "正文",
      source_url: "https://example.com/a",
    });
    vi.mocked(api.summarize).mockResolvedValue({ title: "t", summary: "s", points: [], tags: [] });

    render(<CollectView />);
    fireEvent.change(screen.getByLabelText("网页链接"), {
      target: { value: "https://example.com/a" },
    });
    fireEvent.click(screen.getByRole("button", { name: "提炼" }));

    expect(await screen.findByText(/正文会发送到 Anthropic 处理/)).toBeInTheDocument();
    await screen.findByRole("button", { name: "保存为笔记" });
  });
});
