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
  const [testing, setTesting] = useState(false);
  const [testNote, setTestNote] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    api
      .getSettings()
      .then((r) => applyResponse(r))
      .catch((e) => setError(e instanceof Error ? e.message : "加载设置失败"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 数据存储位置
  const [storageDir, setStorageDir] = useState("");
  const [newPath, setNewPath] = useState("");
  const [storageBusy, setStorageBusy] = useState(false);
  const [storageMsg, setStorageMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    api
      .getStorage()
      .then((g) => {
        setStorageDir(g.dir);
        setNewPath(g.dir);
      })
      .catch(() => {});
  }, []);

  function desktopBridge(): { choose_folder?: () => Promise<unknown> } | undefined {
    const anyWin = window as unknown as { pywebview?: { api?: never } };
    return anyWin.pywebview?.api as { choose_folder?: () => Promise<unknown> } | undefined;
  }

  async function chooseStorageFolder() {
    const b = desktopBridge();
    if (!b?.choose_folder) {
      setStorageMsg({ ok: false, text: "请手动粘贴目标文件夹路径（浏览器模式不支持选文件夹）" });
      return;
    }
    try {
      const res = (await b.choose_folder()) as { ok?: boolean; path?: string; cancelled?: boolean; error?: string };
      if (res && res.ok && res.path) {
        setNewPath(res.path);
        setStorageMsg(null);
      }
    } catch {
      setStorageMsg({ ok: false, text: "无法打开文件夹选择框" });
    }
  }

  async function saveStorageLocation() {
    const path = newPath.trim();
    if (!path) {
      setStorageMsg({ ok: false, text: "请填写目标文件夹路径" });
      return;
    }
    setStorageBusy(true);
    setStorageMsg(null);
    try {
      const r = await api.setStorage(path);
      setStorageDir(r.dir);
      setStorageMsg({
        ok: true,
        text: `已迁移到 ${r.dir}（原数据保留未删）。请重启 RedNote 生效。`,
      });
    } catch (e) {
      setStorageMsg({ ok: false, text: e instanceof Error ? e.message : "迁移失败" });
    } finally {
      setStorageBusy(false);
    }
  }

  async function resetStorageLocation() {
    setStorageBusy(true);
    setStorageMsg(null);
    try {
      const r = await api.resetStorage();
      setStorageMsg({ ok: true, text: `已恢复默认位置。请重启 RedNote 生效（默认：${r.dir}）。` });
    } catch (e) {
      setStorageMsg({ ok: false, text: e instanceof Error ? e.message : "重置失败" });
    } finally {
      setStorageBusy(false);
    }
  }

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

  async function testConnection() {
    if (provider === "mock") return;
    setTesting(true);
    setTestNote(null);
    setError("");
    const group = edits[provider as CloudProvider];
    const body: { provider: string; base_url?: string; model?: string; api_key?: string } = { provider };
    if (OPENAI_LIKE.includes(provider as CloudProvider) && group.baseUrl.trim()) {
      body.base_url = group.baseUrl.trim();
    }
    if (group.model.trim()) body.model = group.model.trim();
    if (group.apiKey.trim()) body.api_key = group.apiKey.trim();
    try {
      const r = await api.testProvider(body);
      setTestNote({ ok: true, text: `连接成功${r.reply ? ` · 模型回复：${r.reply}` : ""}` });
    } catch (e) {
      setTestNote({ ok: false, text: e instanceof Error ? e.message : "连接失败" });
    } finally {
      setTesting(false);
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
                  onChange={() => {
                    setProvider(id);
                    setTestNote(null);
                  }}
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

        {cur && curView && (
          <div className="field-test">
            <button
              className="btn btn-ghost btn-sm"
              onClick={testConnection}
              disabled={busy || testing}
            >
              {testing ? "测试中…" : "测试连接"}
            </button>
            {testNote && (
              <span className={`test-note ${testNote.ok ? "ok" : "err"}`} role={testNote.ok ? "status" : "alert"}>
                {testNote.text}
              </span>
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

      <section className="panel storage-panel">
        <div className="panel-head">
          <span className="lbl">数据存储位置</span>
        </div>
        <div className="data-body">
          <p>
            笔记数据默认存在你的用户目录。可自选到其它文件夹（如 D 盘、同步盘）：
            保存后会把 <code>rednote.db / settings.json / attachments</code> 复制过去，
            <strong>原数据保留不删除</strong>；重启 RedNote 后使用新位置。
          </p>
          <div className="storage-row">
            <span className="field-label">当前数据目录</span>
            <code className="storage-dir">{storageDir || "…"}</code>
          </div>
          <label className="field storage-new">
            <span>新目录路径</span>
            <input
              type="text"
              value={newPath}
              onChange={(e) => setNewPath(e.target.value)}
              placeholder="C:\Users\你\AppData\Roaming\RedNote 或 D:\Notes"
              aria-label="新数据目录路径"
            />
          </label>
          <div className="data-actions">
            {desktopBridge()?.choose_folder && (
              <button className="btn btn-ghost btn-sm" onClick={chooseStorageFolder}>
                选择文件夹
              </button>
            )}
            <button className="btn btn-primary btn-sm" onClick={saveStorageLocation} disabled={storageBusy}>
              {storageBusy ? "处理中…" : "迁移并重启"}
            </button>
            <button className="btn btn-ghost btn-sm" onClick={resetStorageLocation} disabled={storageBusy}>
              恢复默认位置
            </button>
          </div>
          {storageMsg && (
            <div className={`storage-note ${storageMsg.ok ? "ok" : "err"}`} role={storageMsg.ok ? "status" : "alert"}>
              {storageMsg.text}
            </div>
          )}
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
