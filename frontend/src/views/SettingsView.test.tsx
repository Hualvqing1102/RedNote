import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../api/client";
import SettingsView from "./SettingsView";
import type { SettingsActive, SettingsResponse } from "../types";
import type { SettingsView as SettingsT } from "../types";

vi.mock("../api/client", () => ({
  api: {
    getSettings: vi.fn(),
    saveSettings: vi.fn(),
  },
}));

function sv(over: Partial<SettingsT> = {}): SettingsT {
  const base: SettingsT = {
    provider: "mock",
    claude: { model: "claude-3-5-sonnet-20241022", has_key: false },
    openai: { base_url: "http://127.0.0.1:11434/v1", model: "qwen2.5", has_key: false },
    deepseek: { base_url: "https://api.deepseek.com", model: "deepseek-chat", has_key: false },
    qwen: { base_url: "https://dashscope.aliyuncs.com/compatible-mode/v1", model: "qwen-plus", has_key: false },
  };
  return {
    provider: over.provider ?? base.provider,
    claude: { ...base.claude, ...over.claude },
    openai: { ...base.openai, ...over.openai },
    deepseek: { ...base.deepseek, ...over.deepseek },
    qwen: { ...base.qwen, ...over.qwen },
  };
}

function res(settings: SettingsT, active?: SettingsActive): SettingsResponse {
  return { settings, active: active ?? { provider: settings.provider, available: settings.provider === "mock" } };
}

const MOCK_DEFAULTS: SettingsResponse = res(sv());

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

  it("DeepSeek 与通义千问 Qwen 选项可见并预填官方地址", async () => {
    render(<SettingsView />);
    await screen.findByText("本地规则（Mock）");

    fireEvent.click(screen.getByRole("radio", { name: /DeepSeek（深度求索）/i }));
    expect(screen.getByLabelText("模型名")).toHaveValue("deepseek-chat");
    expect(screen.getByLabelText("Base URL")).toHaveValue("https://api.deepseek.com");
    expect(screen.getByLabelText("API Key")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("radio", { name: /通义千问 Qwen/ }));
    expect(screen.getByLabelText("Base URL")).toHaveValue("https://dashscope.aliyuncs.com/compatible-mode/v1");
    expect(screen.getByLabelText("模型名")).toHaveValue("qwen-plus");
  });

  it("已配置云端 Claude 时显示云端警告与引擎标签", async () => {
    vi.mocked(api.getSettings).mockResolvedValue(
      res(sv({ provider: "claude", claude: { has_key: true } }), { provider: "claude", available: true })
    );
    render(<SettingsView />);
    await screen.findByText("Claude 云端");
    expect(screen.getByText(/会发送到对应的云端 API 处理/)).toBeInTheDocument();
  });

  it("保存 DeepSeek 配置时提交对应 patch", async () => {
    vi.mocked(api.saveSettings).mockResolvedValue(
      res(sv({ provider: "deepseek", deepseek: { has_key: true } }), { provider: "deepseek", available: true })
    );
    render(<SettingsView />);
    await screen.findByText("本地规则（Mock）");

    fireEvent.click(screen.getByRole("radio", { name: /DeepSeek（深度求索）/i }));
    fireEvent.change(screen.getByLabelText("API Key"), { target: { value: "sk-ds-secret" } });
    fireEvent.click(screen.getByRole("button", { name: "保存设置" }));

    await waitFor(() => {
      expect(api.saveSettings).toHaveBeenCalledWith({
        provider: "deepseek",
        deepseek: { base_url: "https://api.deepseek.com", model: "deepseek-chat", api_key: "sk-ds-secret" },
      });
    });
    expect(await screen.findByRole("status")).toBeInTheDocument();
  });

  it("保存设置时提交 patch 并提示成功", async () => {
    vi.mocked(api.saveSettings).mockResolvedValue(
      res(sv({ provider: "claude", claude: { has_key: true } }), { provider: "claude", available: true })
    );
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
