import { useState } from "react";
import { api } from "../api/client";
import { describeEngine, sendsToCloud } from "../lib/provider";
import { renderBlocks, withoutLeadingTitle } from "../lib/markdown";
import { useAppStore } from "../store/useAppStore";
import type { CollectResult, NoteInput, SettingsResponse, Summary } from "../types";

const EXAMPLES = [
  "example.com/transformer",
  "example.com/para-method",
  "example.com/learning-how-to-learn",
];

const STEPS = [
  { label: "正在读取网页正文…", sub: "从页面中剔除广告与导航" },
  { label: "Agent 正在提炼要点与摘要…", sub: "按设置的 Provider 生成" },
  { label: "生成建议标签…", sub: "保存后仍可修改" },
];

type Phase = 0 | 1 | 2 | 3 | 4; // 0=空闲/出错, 1~3=分步进行中, 4=完成

function stageStatus(phase: Phase, index: number): "done" | "active" | "pending" {
  if (phase > index + 1 || phase === 4) return "done";
  if (phase === index + 1) return "active";
  return "pending";
}

export default function CollectView() {
  const setView = useAppStore((s) => s.setView);
  const [url, setUrl] = useState("");
  const [phase, setPhase] = useState<Phase>(0);
  const [draft, setDraft] = useState<{ collect: CollectResult; summary: Summary } | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [engine, setEngine] = useState<SettingsResponse | null>(null);
  const [engineError, setEngineError] = useState(false);

  async function start() {
    const target = url.trim();
    if (!target) {
      setError("请先粘贴一个网页链接");
      return;
    }
    setError("");
    setDraft(null);
    setPhase(1);
    // 先取一次设置，用于明示当前总结由什么引擎处理(隐私提示)
    try {
      setEngine(await api.getSettings());
    } catch {
      setEngineError(true);
    }
    try {
      const collect = await api.collectUrl(target);
      setPhase(2);
      const summary = await api.summarize(collect.title, collect.content);
      setPhase(3);
      setDraft({ collect, summary });
      setPhase(4);
    } catch (e) {
      setError(e instanceof Error ? e.message : "采集失败，请检查链接");
      setPhase(0);
    }
  }

  async function save() {
    if (!draft) return;
    setSaving(true);
    setError("");
    // 正文存为 Markdown：去掉与笔记标题重复的正文首行标题，避免详情页重复展示
    const content = withoutLeadingTitle(draft.collect.content, draft.collect.title);
    const input: NoteInput = {
      title: draft.summary.title,
      summary: draft.summary.summary,
      content,
      points: draft.summary.points,
      source_url: draft.collect.source_url,
      source_snapshot: draft.collect.content,
      tags: draft.summary.tags,
    };
    try {
      await api.createNote(input);
      setView("library");
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存失败");
      setSaving(false);
    }
  }

  function reset() {
    setDraft(null);
    setPhase(0);
    setError("");
    setUrl("");
  }

  const busy = phase >= 1 && phase <= 3;

  const engineCloud = engine !== null && sendsToCloud(engine);
  const engineText = engineError
    ? "无法读取模型设置，将按默认本地规则处理"
    : engine
      ? describeEngine(engine)
      : "";
  const showEngine = Boolean(engine || engineError);

  return (
    <div className="collect-wrap">
      <div className="collect-hero">
        <div className="eyebrow">Capture → Distill → Keep</div>
        <h2>把网页里的知识，提炼成你自己的笔记</h2>
        <p>粘贴一篇文章的链接，RedNote 帮你读原文、提炼要点、打上标签。内容只保存在你的电脑上。</p>
      </div>

      <div className="urlbar">
        <input
          type="text"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && !busy && start()}
          placeholder="粘贴网页链接，例如 https://…"
          aria-label="网页链接"
        />
        <button className="btn btn-primary" onClick={start} disabled={busy}>
          提炼
        </button>
      </div>

      <div className="examples">
        {EXAMPLES.map((ex) => (
          <button key={ex} className="example-chip" onClick={() => setUrl(`https://${ex}`)}>
            {ex}
          </button>
        ))}
      </div>

      {error && (
        <div className="error-banner" role="alert">
          {error}
        </div>
      )}

      {showEngine && (
        <div className={`engine-note${engineCloud ? " warn" : ""}`}>
          <span className="dot" />
          {engineText}
        </div>
      )}

      {phase > 0 && phase < 4 && (
        <div className="collect-stages">
          {STEPS.map((step, i) => {
            const status = stageStatus(phase, i);
            return (
              <div className={`stage ${status}`} key={step.label}>
                <span className="spinner" />
                <span className="check">✓</span>
                <div>
                  <div className="t">{step.label}</div>
                  <div className="d">{step.sub}</div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {draft && phase === 4 && (
        <div className="collect-result">
          <div className="result-grid">
            <section className="panel">
              <div className="panel-head">
                <span className="lbl">原文摘录</span>
                <span className="lbl">{draft.collect.content.length.toLocaleString()} 字</span>
              </div>
              <div className="panel-body article">
                <h3>{draft.collect.title}</h3>
                <div className="src">{draft.collect.source_url}</div>
                {renderBlocks(withoutLeadingTitle(draft.collect.content, draft.collect.title))}
              </div>
            </section>

            <section className="panel">
              <div className="panel-head">
                <span className="lbl">Agent 提炼的笔记</span>
              </div>
              <div className="panel-body">
                <div className="summary-block">
                  <h4>摘要</h4>
                  <p>{draft.summary.summary || "（暂无摘要，可直接保存后编辑）"}</p>
                </div>
                {draft.summary.points.length > 0 && (
                  <div className="summary-block">
                    <h4>要点</h4>
                    <ul className="points">
                      {draft.summary.points.map((p, i) => (
                        <li key={i}>{p}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {draft.summary.tags.length > 0 && (
                  <div className="tag-row">
                    {draft.summary.tags.map((t) => (
                      <span className="tag" key={t}>
                        {t}
                      </span>
                    ))}
                  </div>
                )}
                <div className="result-actions">
                  <button className="btn btn-primary" onClick={save} disabled={saving}>
                    {saving ? "保存中…" : "保存为笔记"}
                  </button>
                  <button className="btn btn-ghost" onClick={reset}>
                    重新提炼
                  </button>
                </div>
              </div>
            </section>
          </div>
        </div>
      )}
    </div>
  );
}
