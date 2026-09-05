import { describe, expect, it } from "vitest";
import { describeEngine, isLocalBaseUrl, providerLabel, sendsToCloud } from "./provider";
import type { SettingsResponse } from "../types";

function resp(partial: Partial<SettingsResponse>): SettingsResponse {
  return {
    settings: {
      provider: "mock",
      claude: { model: "claude-3-5-sonnet-20241022", has_key: false },
      openai: { base_url: "https://api.deepseek.com/v1", model: "deepseek-chat", has_key: false },
    },
    active: { provider: "mock", available: true },
    ...partial,
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
    expect(
      sendsToCloud(
        resp({ settings: { provider: "mock", claude: { model: "m", has_key: false }, openai: { base_url: "https://x", model: "m", has_key: false } }, active: { provider: "mock", available: true } })
      )
    ).toBe(false);
    expect(
      sendsToCloud(
        resp({ settings: { provider: "openai", claude: { model: "m", has_key: false }, openai: { base_url: "https://api.deepseek.com/v1", model: "m", has_key: false } }, active: { provider: "openai", available: false } })
      )
    ).toBe(false);
  });

  it("Claude 与远端 OpenAI 兼容服务会发送到云端", () => {
    expect(
      sendsToCloud(
        resp({ settings: { provider: "claude", claude: { model: "m", has_key: true }, openai: { base_url: "https://x", model: "m", has_key: false } }, active: { provider: "claude", available: true } })
      )
    ).toBe(true);
    expect(
      sendsToCloud(
        resp({ settings: { provider: "openai", claude: { model: "m", has_key: false }, openai: { base_url: "https://api.deepseek.com/v1", model: "m", has_key: true } }, active: { provider: "openai", available: true } })
      )
    ).toBe(true);
  });

  it("本地模型服务不上云", () => {
    expect(
      sendsToCloud(
        resp({ settings: { provider: "openai", claude: { model: "m", has_key: false }, openai: { base_url: "http://127.0.0.1:11434/v1", model: "m", has_key: true } }, active: { provider: "openai", available: true } })
      )
    ).toBe(false);
  });
});

describe("describeEngine / providerLabel", () => {
  it("云端 Claude 提示正文会上云", () => {
    const r = resp({
      settings: { provider: "claude", claude: { model: "m", has_key: true }, openai: { base_url: "https://x", model: "m", has_key: false } },
      active: { provider: "claude", available: true },
    });
    expect(providerLabel(r)).toContain("Claude");
    expect(describeEngine(r)).toContain("Anthropic");
  });

  it("本地 Ollama 提示数据不离开本机", () => {
    const r = resp({
      settings: { provider: "openai", claude: { model: "m", has_key: false }, openai: { base_url: "http://127.0.0.1:11434/v1", model: "qwen2.5", has_key: true } },
      active: { provider: "openai", available: true },
    });
    expect(providerLabel(r)).toContain("本地模型");
    expect(describeEngine(r)).toContain("不离开本机");
  });
});
