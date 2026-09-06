import { describe, expect, it } from "vitest";
import { describeEngine, isLocalBaseUrl, providerLabel, sendsToCloud } from "./provider";
import type { SettingsActive, SettingsResponse, SettingsView } from "../types";

const EMPTY_GROUPS = {
  claude: { model: "claude-3-5-sonnet-20241022", has_key: false },
  openai: { base_url: "https://api.deepseek.com/v1", model: "deepseek-chat", has_key: false },
  deepseek: { base_url: "https://api.deepseek.com", model: "deepseek-chat", has_key: false },
  qwen: { base_url: "https://dashscope.aliyuncs.com/compatible-mode/v1", model: "qwen-plus", has_key: false },
};

function resp(
  over: { settings?: Partial<SettingsView>; active?: SettingsActive } = {}
): SettingsResponse {
  const s = over.settings ?? {};
  const settings: SettingsView = {
    provider: s.provider ?? "mock",
    claude: { ...EMPTY_GROUPS.claude, ...s.claude },
    openai: { ...EMPTY_GROUPS.openai, ...s.openai },
    deepseek: { ...EMPTY_GROUPS.deepseek, ...s.deepseek },
    qwen: { ...EMPTY_GROUPS.qwen, ...s.qwen },
  };
  return {
    settings,
    active: over.active ?? { provider: settings.provider, available: true },
  };
}

describe("isLocalBaseUrl", () => {
  it("识别本机地址", () => {
    expect(isLocalBaseUrl("http://127.0.0.1:11434/v1")).toBe(true);
    expect(isLocalBaseUrl("http://localhost:8000")).toBe(true);
    expect(isLocalBaseUrl("http://192.168.1.5:8080/v1")).toBe(false);
    expect(isLocalBaseUrl("https://api.deepseek.com/v1")).toBe(false);
  });
});

describe("sendsToCloud", () => {
  it("本地规则与未填 Key 都不上云", () => {
    expect(sendsToCloud(resp({ settings: { provider: "mock" } }))).toBe(false);
    expect(
      sendsToCloud(
        resp({
          settings: { provider: "openai", openai: { base_url: "https://api.deepseek.com/v1", model: "m", has_key: false } },
          active: { provider: "openai", available: false },
        })
      )
    ).toBe(false);
  });

  it("Claude 与远端 OpenAI 兼容服务会发送到云端", () => {
    expect(
      sendsToCloud(
        resp({
          settings: { provider: "claude", claude: { model: "m", has_key: true } },
          active: { provider: "claude", available: true },
        })
      )
    ).toBe(true);
    expect(
      sendsToCloud(
        resp({
          settings: { provider: "openai", openai: { base_url: "https://api.deepseek.com/v1", model: "m", has_key: true } },
          active: { provider: "openai", available: true },
        })
      )
    ).toBe(true);
  });

  it("本地模型服务不上云", () => {
    expect(
      sendsToCloud(
        resp({
          settings: { provider: "openai", openai: { base_url: "http://127.0.0.1:11434/v1", model: "m", has_key: true } },
          active: { provider: "openai", available: true },
        })
      )
    ).toBe(false);
  });

  it("DeepSeek 与通义千问 Qwen 云端 API 会发送到云端", () => {
    expect(
      sendsToCloud(
        resp({
          settings: { provider: "deepseek", deepseek: { has_key: true } },
          active: { provider: "deepseek", available: true },
        })
      )
    ).toBe(true);
    expect(
      sendsToCloud(
        resp({
          settings: { provider: "qwen", qwen: { has_key: true } },
          active: { provider: "qwen", available: true },
        })
      )
    ).toBe(true);
  });
});

describe("describeEngine / providerLabel", () => {
  it("云端 Claude 提示正文会上云", () => {
    const r = resp({
      settings: { provider: "claude", claude: { model: "m", has_key: true } },
      active: { provider: "claude", available: true },
    });
    expect(providerLabel(r)).toContain("Claude");
    expect(describeEngine(r)).toContain("Anthropic");
  });

  it("本地 Ollama 提示数据不离开本机", () => {
    const r = resp({
      settings: { provider: "openai", openai: { base_url: "http://127.0.0.1:11434/v1", model: "qwen2.5", has_key: true } },
      active: { provider: "openai", available: true },
    });
    expect(providerLabel(r)).toContain("本地模型");
    expect(describeEngine(r)).toContain("不离开本机");
  });

  it("DeepSeek / Qwen 未填 Key 时提示、填了 Key 标云端", () => {
    const noKey = resp({
      settings: { provider: "deepseek" },
      active: { provider: "deepseek", available: false },
    });
    expect(providerLabel(noKey)).toContain("DeepSeek");
    expect(providerLabel(noKey)).toContain("未填 Key");

    const qwenOn = resp({
      settings: { provider: "qwen", qwen: { has_key: true } },
      active: { provider: "qwen", available: true },
    });
    expect(providerLabel(qwenOn)).toContain("通义千问");
    expect(providerLabel(qwenOn)).toContain("云端");
    expect(describeEngine(qwenOn)).toContain("通义千问");
  });
});
