import { useEffect, useState } from "react";
import { api } from "../api/client";
import { describeEngine, providerLabel, sendsToCloud } from "../lib/provider";
import type { ProviderName, SettingsResponse } from "../types";

type CloudProvider = "claude" | "openai" | "deepseek" | "qwen";
const OPENAI_LIKE: CloudProvider[] = ["openai", "deepseek", "qwen"];

interface Editable {
  baseUrl: string;
  model: string;
  apiKey: string;
}

function emptyEdits(): Record<CloudProvider, Editable> {
  return {
    claude: { baseUrl: "", model: "", apiKey: "" },
    openai: { baseUrl: "", model: "", apiKey: "" },
    deepseek: { baseUrl: "", model: "", apiKey: "" },
    qwen: { baseUrl: "", model: "", apiKey: "" },
  };
}

const CARDS: { id: ProviderName; title: string; desc: string }[] = [
  { id: "mock", title: "本地规则（默认）", desc: "不联网，用于体验全流程" },
  { id: "deepseek", title: "DeepSeek（深度求索）", desc: "国产云端 API · OpenAI 兼容" },
  { id: "qwen", title: "通义千问 Qwen（阿里云百炼）", desc: "国产云端 API · OpenAI 兼容" },
  { id: "openai", title: "OpenAI 兼容端点", desc: "Ollama / LM Studio / 本地模型" },
  { id: "claude", title: "Claude（Anthropic）", desc: "云端 API" },
];

export default function SettingsView() {
  const [resp, setResp] = useState<SettingsResponse | null>(null);
  const [provider, setProvider] = useState<ProviderName>("mock");
  const [edits, setEdits] = useState<Record<CloudProvider, Editable>>(emptyEdits());
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
    setEdits({
      claude: { baseUrl: "", model: r.settings.claude.model || "", apiKey: "" },
      openai: { baseUrl: r.settings.openai.base_url || "", model: r.settings.openai.model || "", apiKey: "" },
      deepseek: { baseUrl: r.settings.deepseek.base_url || "", model: r.settings.deepseek.model || "", apiKey: "" },
      qwen: { baseUrl: r.settings.qwen.base_url || "", model: r.settings.qwen.model || "", apiKey: "" },
    });
  }

  function setField(group: CloudProvider, key: keyof Editable, value: string) {
    setEdits((prev) => ({ ...prev, [group]: { ...prev[group], [key]: value } }));
  }

  async function save() {
    setBusy(true);
    setError("");
    setSaved(false);
    const patch: Record<string, unknown> = { provider };
    if (provider !== "mock") {
      const group = edits[provider as CloudProvider];
      const g: { base_url?: string; model?: string; api_key?: string } = {};
      if (group.baseUrl.trim()) g.base_url = group.baseUrl.trim();
      if (group.model.trim()) g.model = group.model.trim();
      if (group.apiKey.trim()) g.api_key = group.apiKey.trim();
      if (Object.keys(g).length > 0) patch[provider] = g;
    }
    try {
      const r = await api.saveSettings(patch as Parameters<typeof api.saveSettings>[0]);
      applyResponse(r);
      setSaved(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存失败");
    } finally {
      setBusy(false);
    }
  }

  async function clearKey(group: CloudProvider) {
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
  const cur = provider === "mock" ? null : edits[provider as CloudProvider];
  const curView = provider === "mock" ? null : resp.settings[provider as CloudProvider];

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
            {CARDS.map(({ id, title, desc }) => (
              <label className={`radio-card${provider === id ? " active" : ""}`} key={id}>
                <input
                  type="radio"
                  name="provider"
                  value={id}
                  checked={provider === id}
                  onChange={() => setProvider(id)}
                />
                <span className="t">{title}</span>
                <span className="d">{desc}</span>
              </label>
            ))}
          </div>
        </div>

        {cur && curView && (
          <div className="setting-block fields">
            {OPENAI_LIKE.includes(provider as CloudProvider) && (
              <div className="field">
                <label htmlFor={`${provider}-base`}>Base URL</label>
                <input
                  id={`${provider}-base`}
                  type="text"
                  value={cur.baseUrl}
                  onChange={(e) => setField(provider as CloudProvider, "baseUrl", e.target.value)}
                  placeholder="https://api.deepseek.com 或 http://127.0.0.1:11434/v1"
                />
              </div>
            )}
            <div className="field">
              <label htmlFor={`${provider}-model`}>
                {provider === "claude" ? "模型" : "模型名"}
              </label>
              <input
                id={`${provider}-model`}
                type="text"
                value={cur.model}
                onChange={(e) => setField(provider as CloudProvider, "model", e.target.value)}
                placeholder={curView.model ? curView.model : "deepseek-chat / qwen-plus / …"}
              />
            </div>
            <div className="field">
              <label htmlFor={`${provider}-key`}>API Key</label>
              <input
                id={`${provider}-key`}
                type="password"
                value={cur.apiKey}
                onChange={(e) => setField(provider as CloudProvider, "apiKey", e.target.value)}
                placeholder={
                  curView.has_key
                    ? "已配置（输入新 Key 可替换；留空保持不变）"
                    : provider === "openai"
                      ? "本地 Ollama 可留空"
                      : "粘贴你的 API Key"
                }
                autoComplete="off"
              />
              {curView.has_key && (
                <button
                  className="btn btn-ghost btn-sm key-clear"
                  onClick={() => clearKey(provider as CloudProvider)}
                  disabled={busy}
                >
                  移除已存 Key
                </button>
              )}
            </div>
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

      <section className="panel data-panel">
        <div className="panel-head">
          <span className="lbl">数据备份（防锁定）</span>
        </div>
        <div className="data-body">
          <p>
            数据只保存在你的电脑上（SQLite 单文件）。可以随时下载整库备份，或把全部笔记导出为
            Markdown——即使离开本应用，数据也始终归你。
          </p>
          <div className="data-actions">
            <a className="btn btn-ghost btn-sm" href="/api/export/backup.db" download="rednote-backup.db">
              备份数据库（.db）
            </a>
            <a className="btn btn-ghost btn-sm" href="/api/export/notes.md" download="rednote-notes.md">
              导出全部笔记（Markdown）
            </a>
          </div>
        </div>
      </section>
    </div>
  );
}
