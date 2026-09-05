import type { SettingsResponse } from "../types";

const LOCAL_HOSTS = ["localhost", "127.0.0.1", "0.0.0.0", "[::1]"];

/** base_url 是否指向本机(离线)服务。 */
export function isLocalBaseUrl(baseUrl?: string): boolean {
  if (!baseUrl) return false;
  try {
    return LOCAL_HOSTS.some((h) => new URL(baseUrl).hostname === h);
  } catch {
    return false;
  }
}

/** 数据是否会离开本机(发送到云端 API)。 */
export function sendsToCloud(resp: SettingsResponse): boolean {
  const { provider, available } = resp.active;
  if (provider === "mock") return false;
  if (!available) return false; // 未填 Key，实际走本地规则
  if (provider === "claude") return true;
  return !isLocalBaseUrl(resp.settings.openai.base_url);
}

/** 一句话说明当前「总结/追问」由什么引擎处理(用于 UI 明示，呼应隐私承诺)。 */
export function describeEngine(resp: SettingsResponse): string {
  const { provider, available } = resp.active;
  if (provider === "mock" || !available) {
    return "本地规则生成（未联网，配置真实模型后可获得 AI 摘要）";
  }
  if (provider === "claude") {
    return "由 Claude（云端 API）生成：正文会发送到 Anthropic 处理";
  }
  const base = resp.settings.openai.base_url || "";
  if (isLocalBaseUrl(base)) {
    return `由本地模型服务生成（${base}，数据不离开本机）`;
  }
  return `由云端 OpenAI 兼容服务生成（${base}）：正文会发送到该服务处理`;
}

/** 引擎名(用于设置页当前生效标签)。 */
export function providerLabel(resp: SettingsResponse): string {
  const { provider, available } = resp.active;
  if (provider === "mock") return "本地规则（Mock）";
  if (provider === "claude") return available ? "Claude 云端" : "Claude（未填 Key）";
  if (provider === "openai") {
    if (!available) return "OpenAI 兼容（未填 Key）";
    return isLocalBaseUrl(resp.settings.openai.base_url)
      ? "本地模型（OpenAI 兼容）"
      : "云端 OpenAI 兼容";
  }
  return provider;
}
