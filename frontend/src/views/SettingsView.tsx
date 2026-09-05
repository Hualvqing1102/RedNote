import { useEffect, useState } from "react";
import { api } from "../api/client";
import { describeEngine, providerLabel, sendsToCloud } from "../lib/provider";
import type { ProviderName, SettingsResponse } from "../types";

export default function SettingsView() {
  const [resp, setResp] = useState<SettingsResponse | null>(null);
  const [provider, setProvider] = useState<ProviderName>("mock");
  const [claudeModel, setClaudeModel] = useState("");
  const [claudeKey, setClaudeKey] = useState("");
  const [openaiBase, setOpenaiBase] = useState("");
  const [openaiModel, setOpenaiModel] = useState("");
  const [openaiKey, setOpenaiKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    api
      .getSettings()
      .then((r) => applyResponse(r))
      .catch((e) => setError(e instanceof Error ? e.message : "加载设置失败"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function applyResponse(r: SettingsResponse) {
    setResp(r);
    setProvider(r.settings.provider);
    setClaudeModel(r.settings.claude.model || "");
    setClaudeKey("");
    setOpenaiBase(r.settings.openai.base_url || "");
    setOpenaiModel(r.settings.openai.model || "");
    setOpenaiKey("");
  }

  async function save() {
    setBusy(true);
    setError("");
    setSaved(false);
    const patch: Parameters<typeof api.saveSettings>[0] = { provider };
    if (provider === "claude") {
      const group: { model?: string; api_key?: string } = {};
      if (claudeModel.trim()) group.model = claudeModel.trim();
      if (claudeKey.trim()) group.api_key = claudeKey.trim();
      if (Object.keys(group).length > 0) patch.claude = group;
    } else if (provider === "openai") {
      const group: { base_url?: string; model?: string; api_key?: string } = {};
      if (openaiBase.trim()) group.base_url = openaiBase.trim();
      if (openaiModel.trim()) group.model = openaiModel.trim();
      if (openaiKey.trim()) group.api_key = openaiKey.trim();
      if (Object.keys(group).length > 0) patch.openai = group;
    }
    try {
      const r = await api.saveSettings(patch);
      applyResponse(r);
      setSaved(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存失败");
    } finally {
      setBusy(false);
    }
  }

  async function clearKey(group: "claude" | "openai") {
    setBusy(true);
    setError("");
    try {
      const r = await api.saveSettings({ [group]: { api_key: "" } } as never);
      applyResponse(r);
      setSaved(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "清除失败");
    } finally {
      setBusy(false);
    }
  }

  if (!resp) {
    return <div className="hint">{error || "加载中…"}</div>;
  }

  const cloud = sendsToCloud(resp);

  return (
    <div className="settings-wrap">
      <section className="panel">
        <div className="panel-head">
          <span className="lbl">AI 模型（用于总结与追问）</span>
          <span className={`engine-badge${cloud ? " cloud" : ""}`}>{providerLabel(resp)}</span>
        </div>

        <div className={`privacy-note${cloud ? " warn" : ""}`} role="note">
          {cloud
            ? "注意：启用云端模型后，采集到的正文与你的提问会发送到对应的云端 API 处理。"
            : "当前模式不会把正文发送到云端：本地规则或本机模型服务处理，数据不离开你的电脑。"}
          <span className="dim"> · API Key 仅保存在本地设置文件（data/settings.json），不会上传。</span>
        </div>

        <div className="setting-block">
          <div className="field-label">Provider</div>
          <div className="radio-row">
            {(
              [
                ["mock", "本地规则（默认）", "不联网，用于体验全流程"],
                ["claude", "Claude（Anthropic）", "云端 API"],
                ["openai", "OpenAI 兼容端点", "DeepSeek 云 / Ollama / LM Studio / 本地模型"],
              ] as const
            ).map(([value, title, desc]) => (
              <label className={`radio-card${provider === value ? " active" : ""}`} key={value}>
                <input
                  type="radio"
                  name="provider"
                  value={value}
                  checked={provider === value}
                  onChange={() => setProvider(value)}
                />
                <span className="t">{title}</span>
                <span className="d">{desc}</span>
              </label>
            ))}
          </div>
        </div>

        {provider !== "mock" && (
          <div className="setting-block fields">
            {provider === "claude" && (
              <>
                <div className="field">
                  <label htmlFor="claude-model">模型</label>
                  <input
                    id="claude-model"
                    type="text"
                    value={claudeModel}
                    onChange={(e) => setClaudeModel(e.target.value)}
                    placeholder="claude-3-5-sonnet-20241022"
                  />
                </div>
                <div className="field">
                  <label htmlFor="claude-key">API Key</label>
                  <input
                    id="claude-key"
                    type="password"
                    value={claudeKey}
                    onChange={(e) => setClaudeKey(e.target.value)}
                    placeholder={
                      resp.settings.claude.has_key
                        ? "已配置（输入新 Key 可替换；留空保持不变）"
                        : "sk-ant-…"
                    }
                    autoComplete="off"
                  />
                  {resp.settings.claude.has_key && (
                    <button
                      className="btn btn-ghost btn-sm key-clear"
                      onClick={() => clearKey("claude")}
                      disabled={busy}
                    >
                      移除已存 Key
                    </button>
                  )}
                </div>
              </>
            )}

            {provider === "openai" && (
              <>
                <div className="field">
                  <label htmlFor="openai-base">Base URL</label>
                  <input
                    id="openai-base"
                    type="text"
                    value={openaiBase}
                    onChange={(e) => setOpenaiBase(e.target.value)}
                    placeholder="https://api.deepseek.com/v1 或 http://127.0.0.1:11434/v1"
                  />
                </div>
                <div className="field">
                  <label htmlFor="openai-model">模型名</label>
                  <input
                    id="openai-model"
                    type="text"
                    value={openaiModel}
                    onChange={(e) => setOpenaiModel(e.target.value)}
                    placeholder="deepseek-chat / qwen2.5 / …"
                  />
                </div>
                <div className="field">
                  <label htmlFor="openai-key">API Key</label>
                  <input
                    id="openai-key"
                    type="password"
                    value={openaiKey}
                    onChange={(e) => setOpenaiKey(e.target.value)}
                    placeholder={
                      resp.settings.openai.has_key
                        ? "已配置（输入新 Key 可替换；留空保持不变）"
                        : "本地 Ollama 可留空"
                    }
                    autoComplete="off"
                  />
                  {resp.settings.openai.has_key && (
                    <button
                      className="btn btn-ghost btn-sm key-clear"
                      onClick={() => clearKey("openai")}
                      disabled={busy}
                    >
                      移除已存 Key
                    </button>
                  )}
                </div>
              </>
            )}
          </div>
        )}

        {error && (
          <div className="error-banner" role="alert">
            {error}
          </div>
        )}
        {saved && (
          <div className="success-banner" role="status">
            已保存 · {describeEngine(resp)}
          </div>
        )}

        <div className="setting-actions">
          <button className="btn btn-primary" onClick={save} disabled={busy}>
            {busy ? "保存中…" : "保存设置"}
          </button>
        </div>
      </section>
    </div>
  );
}
