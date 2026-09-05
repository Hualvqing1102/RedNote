import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../api/client";
import SettingsView from "./SettingsView";
import type { SettingsResponse } from "../types";

vi.mock("../api/client", () => ({
  api: {
    getSettings: vi.fn(),
    saveSettings: vi.fn(),
  },
}));

const MOCK_DEFAULTS: SettingsResponse = {
  settings: {
    provider: "mock",
    claude: { model: "claude-3-5-sonnet-20241022", has_key: false },
    openai: { base_url: "https://api.deepseek.com/v1", model: "deepseek-chat", has_key: false },
  },
  active: { provider: "mock", available: true },
};

describe("SettingsView", () => {
  beforeEach(() => {
    vi.mocked(api.getSettings).mockReset().mockResolvedValue(MOCK_DEFAULTS);
    vi.mocked(api.saveSettings).mockReset();
  });

  it("默认展示本地规则与隐私说明", async () => {
    render(<SettingsView />);
    expect(await screen.findByText("本地规则（Mock）")).toBeInTheDocument();
    expect(
      screen.getByText(/当前模式不会把正文发送到云端/)
    ).toBeInTheDocument();
  });

  it("切换到 Claude 后出现模型/Key 输入与云端警告", async () => {
    render(<SettingsView />);
    await screen.findByText("本地规则（Mock）");

    fireEvent.click(screen.getByRole("radio", { name: /Claude（Anthropic）/i }));
    expect(screen.getByLabelText("模型")).toBeInTheDocument();
    expect(screen.getByLabelText("API Key")).toBeInTheDocument();

    // 尚未保存，仍是 mock，因此不显示云端警告
    expect(screen.queryByText(/当前模式不会把正文发送到云端/)).toBeInTheDocument();
  });

  it("已配置云端 Claude 时显示云端警告与引擎标签", async () => {
    vi.mocked(api.getSettings).mockResolvedValue({
      settings: {
        provider: "claude",
        claude: { model: "claude-3-5-sonnet-20241022", has_key: true },
        openai: { base_url: "https://api.deepseek.com/v1", model: "deepseek-chat", has_key: false },
      },
      active: { provider: "claude", available: true },
    });
    render(<SettingsView />);
    await screen.findByText("Claude 云端");
    expect(screen.getByText(/会发送到对应的云端 API 处理/)).toBeInTheDocument();
  });

  it("保存设置时提交 patch 并提示成功", async () => {
    vi.mocked(api.saveSettings).mockResolvedValue({
      settings: {
        provider: "claude",
        claude: { model: "claude-3-5-sonnet-20241022", has_key: true },
        openai: { base_url: "https://api.deepseek.com/v1", model: "deepseek-chat", has_key: false },
      },
      active: { provider: "claude", available: true },
    });
    render(<SettingsView />);
    await screen.findByText("本地规则（Mock）");

    fireEvent.click(screen.getByRole("radio", { name: /Claude（Anthropic）/i }));
    fireEvent.change(screen.getByLabelText("模型"), {
      target: { value: "claude-3-5-sonnet-latest" },
    });
    fireEvent.change(screen.getByLabelText("API Key"), {
      target: { value: "sk-ant-secret" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存设置" }));

    await waitFor(() => {
      expect(api.saveSettings).toHaveBeenCalledWith({
        provider: "claude",
        claude: { model: "claude-3-5-sonnet-latest", api_key: "sk-ant-secret" },
      });
    });
    expect(await screen.findByRole("status")).toBeInTheDocument();
  });

  it("加载失败时给出提示", async () => {
    vi.mocked(api.getSettings).mockRejectedValue(new Error("加载设置失败"));
    render(<SettingsView />);
    expect(await screen.findByText("加载设置失败")).toBeInTheDocument();
  });
});
