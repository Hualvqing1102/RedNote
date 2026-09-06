import { useRef, useState } from "react";
import { api } from "../api/client";
import { describeEngine, sendsToCloud } from "../lib/provider";
import { renderBlocks, withoutLeadingTitle } from "../lib/markdown";
import { useAppStore } from "../store/useAppStore";
import type { CollectResult, ExplainResult, NoteInput, SettingsResponse, Summary } from "../types";

const EXAMPLES = [
  "example.com/transformer",
  "example.com/para-method",
  "example.com/learning-how-to-learn",
];

const STEPS = [
  { label: "正在读取内容…", sub: "从网页或本地文档中提取正文" },
  { label: "Agent 正在提炼要点与摘要…", sub: "按设置的 Provider 生成" },
  { label: "整理为笔记草稿…", sub: "确认后可保存" },
];

const ACCEPT_EXTS = ".pdf,.docx,.txt,.md";
const FILE_EXTS = ["pdf", "docx", "txt", "md"];

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
  const [draft, setDraft] = useState<{
    collect: CollectResult;
    summary: Summary;
    explanation?: ExplainResult;
  } | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [engine, setEngine] = useState<SettingsResponse | null>(null);
  const [engineError, setEngineError] = useState(false);
  // 详细讲解模式：不保存原文，改成让 Agent 生成逐段详解
  const [explainMode, setExplainMode] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function start() {
    const target = url.trim();
    if (!target) {
      setError("请先粘贴一个网页链接");
      return;
    }
    setError("");
    setDraft(null);
    try {
      const collect = await api.collectUrl(target);
      await processCollect(collect);
    } catch (e) {
      setError(e instanceof Error ? e.message : "采集失败，请检查链接");
      setPhase(0);
    }
  }

  async function processCollect(collect: CollectResult) {
    setPhase(1);
    // 先取一次设置，用于明示当前总结由什么引擎处理(隐私提示)
    try {
      setEngine(await api.getSettings());
    } catch {
      setEngineError(true);
    }
    try {
      setPhase(2);
      if (explainMode) {
        // 讲解模式：同一篇原文并行生成 摘要+要点 与 详细讲解；不保存原文
        const [summary, explanation] = await Promise.all([
          api.summarize(collect.title, collect.content),
          api.explain(collect.title, collect.content),
        ]);
        setPhase(3);
        setDraft({ collect, summary, explanation });
      } else {
        const summary = await api.summarize(collect.title, collect.content);
        setPhase(3);
        setDraft({ collect, summary });
      }
      setPhase(4);
    } catch (e) {
      setError(e instanceof Error ? e.message : "处理失败，请重试");
      setPhase(0);
    }
  }

  async function handleFiles(files: FileList | null) {
    const file = files && files[0];
    if (!file) return;
    const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
    if (!FILE_EXTS.includes(ext)) {
      setError(`暂不支持「${file.name}」：请使用 PDF / DOCX / TXT / Markdown`);
      return;
    }
    setError("");
    setDraft(null);
    try {
      const collect = await api.collectFile(file);
      await processCollect(collect);
    } catch (e) {
      setError(e instanceof Error ? e.message : "解析文档失败");
      setPhase(0);
    }
  }

  async function save() {
    if (!draft) return;
    setSaving(true);
    setError("");
    if (explainMode && draft.explanation) {
      // 讲解模式：笔记正文 = AI 详细讲解，原文不落地
      const input: NoteInput = {
        title: draft.summary.title,
        summary: draft.summary.summary,
        content: draft.explanation.explanation,
        points: draft.summary.points,
        source_url: draft.collect.source_url,
        source_snapshot: "",
      };
      try {
        await api.createNote(input);
        setView("library");
      } catch (e) {
        setError(e instanceof Error ? e.message : "保存失败");
        setSaving(false);
      }
      return;
    }
    // 常规模式：正文存为 Markdown（去掉与标题重复的首行标题）
    const content = withoutLeadingTitle(draft.collect.content, draft.collect.title);
    const input: NoteInput = {
      title: draft.summary.title,
      summary: draft.summary.summary,
      content,
      points: draft.summary.points,
      source_url: draft.collect.source_url,
      source_snapshot: draft.collect.content,
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
        <p>粘贴一篇文章的链接，或把论文 PDF / DOCX 拖进来，RedNote 帮你读原文、提炼要点，内容只保存在你的电脑上。</p>
      </div>

      <div
        className={`dropzone${dragOver ? " over" : ""}`}
        role="button"
        tabIndex={0}
        aria-label="上传本地文档"
        onClick={() => fileInputRef.current?.click()}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            fileInputRef.current?.click();
          }
        }}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          handleFiles(e.dataTransfer.files);
        }}
      >
        <div className="dz-icon" aria-hidden>📄</div>
        <div className="t">把论文 PDF / DOCX 拖到这里</div>
        <div className="d">或点击选择文件 · 支持 PDF / DOCX / TXT / Markdown · 扫描版 PDF 会自动 OCR</div>
      </div>
      <input
        ref={fileInputRef}
        type="file"
        accept={ACCEPT_EXTS}
        style={{ display: "none" }}
        aria-label="选择本地文档"
        onChange={async (e) => {
          await handleFiles(e.target.files);
          e.target.value = "";
        }}
      />

      <div className="collect-or"><span>或粘贴网页链接</span></div>

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

      <label className={`explain-toggle${busy ? " disabled" : ""}`}>
        <input
          type="checkbox"
          checked={explainMode}
          disabled={busy}
          onChange={(e) => setExplainMode(e.target.checked)}
        />
        <span className="t">详细讲解模式</span>
        <span className="d">不保存原文，改为让 AI 逐段详解</span>
      </label>

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
                <span className="lbl">{explainMode && draft.explanation ? "详细讲解" : "原文摘录"}</span>
                <span className="lbl">
                  {(explainMode && draft.explanation
                    ? draft.explanation.explanation.length
                    : draft.collect.content.length
                  ).toLocaleString()}{" "}
                  字
                </span>
              </div>
              <div className="panel-body article">
                <h3>{draft.collect.title}</h3>
                <div className="src">
                  {draft.collect.filename
                    ? `📄 ${draft.collect.filename}`
                    : draft.collect.source_url}
                </div>
                {explainMode && draft.explanation ? (
                  renderBlocks(draft.explanation.explanation)
                ) : (
                  renderBlocks(withoutLeadingTitle(draft.collect.content, draft.collect.title))
                )}
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
