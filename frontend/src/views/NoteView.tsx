import { useEffect, useRef, useState } from "react";
import type { CSSProperties, MouseEvent as ReactMouseEvent } from "react";
import { api } from "../api/client";
import { describeEngine, sendsToCloud } from "../lib/provider";
import { renderOneBlock, splitBlocks, type Block } from "../lib/markdown";
import { normalizedSelection, rowIndexOf } from "../lib/selection";
import { relocateComment, rowsFor } from "../lib/annotations";
import { useAppStore } from "../store/useAppStore";
import type { CommentCard, Folder, Note, SettingsResponse } from "../types";

interface Msg {
  role: "user" | "ai";
  text: string;
}

interface CtxMenu {
  x: number;
  y: number;
  blockIndex: number;
}

const AUTOSAVE_MS = 900;

let commentSeq = 0;

function newCardId(): string {
  commentSeq += 1;
  return `c${Date.now().toString(36)}${commentSeq}`;
}

function formatDate(epoch: number): string {
  const d = new Date(epoch * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** 用于右键菜单里预览段落内容。 */
function snippetOf(block: Block): string {
  if (block.kind === "heading" || block.kind === "para") return block.text;
  if (block.kind === "quote") return block.lines.join(" ");
  if (block.kind === "ul" || block.kind === "ol") return block.items.join(" · ");
  return "";
}

export default function NoteView() {
  const noteId = useAppStore((s) => s.activeNoteId);
  const setView = useAppStore((s) => s.setView);
  const openNote = useAppStore((s) => s.openNote);

  const [note, setNote] = useState<Note | null>(null);
  const [editing, setEditing] = useState(false);
  const [draftText, setDraftText] = useState("");
  const [titleDraft, setTitleDraft] = useState("");
  const [summaryDraft, setSummaryDraft] = useState("");
  const [pointDrafts, setPointDrafts] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [question, setQuestion] = useState("");
  const [typing, setTyping] = useState(false);
  const [error, setError] = useState("");
  const [engine, setEngine] = useState<SettingsResponse | null>(null);
  const [engineError, setEngineError] = useState(false);
  const [foldersState, setFoldersState] = useState<Folder[]>([]);

  // 注释：内联锚定在正文段落之后
  const [comments, setComments] = useState<CommentCard[]>([]);
  const [commentsDirty, setCommentsDirty] = useState(false);
  const [saveState, setSaveState] = useState<"idle" | "saved" | "error">("idle");
  const [menu, setMenu] = useState<CtxMenu | null>(null);
  const [focusCardId, setFocusCardId] = useState<string | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  // 阅读体验：字号倍率(深色与目录开关已简化/移除)
  const [readerScale, setReaderScale] = useState<number>(() => {
    try {
      const v = parseFloat(localStorage.getItem("rednoteReaderScale") ?? "");
      return Number.isFinite(v) && v >= 0.7 && v <= 1.6 ? v : 1;
    } catch {
      return 1;
    }
  });
  // 处于“编辑中”的注释卡（未确认前显示输入框；确认后显示为摘要卡片样式）
  const [editIds, setEditIds] = useState<Set<string>>(new Set());
  // 正在询问“是否删除”的注释卡（点击删除后先确认，不直接删）
  const [delIds, setDelIds] = useState<Set<string>>(new Set());
  // 阅读页：选中段落后弹出的 Agent 操作
  const [seg, setSeg] = useState<{ x: number; y: number; index: number; text: string } | null>(null);
  const [segAsk, setSegAsk] = useState(false);
  const [segAskQ, setSegAskQ] = useState("");
  const [segBusy, setSegBusy] = useState(false);
  const [segAnswer, setSegAnswer] = useState<string | null>(null);
  const [segSaved, setSegSaved] = useState(false);

  const bodyRef = useRef<HTMLDivElement>(null);
  const lineRef = useRef<HTMLDivElement>(null);
  const threadRef = useRef<HTMLDivElement>(null);
  const commentsRef = useRef(comments);
  commentsRef.current = comments;
  const blocksRef = useRef(0);

  useEffect(() => {
    if (!noteId) return;
    api
      .getNote(noteId)
      .then((n) => {
        setNote(n);
        setDraftText(n.content);
        setTitleDraft(n.title);
        setSummaryDraft(n.summary || "");
        setPointDrafts(n.points || []);
        // 空白笔记(如“＋ 新建笔记”)打开后直接进入编辑
        const blank = !n.content.trim() && !n.summary.trim();
        setEditing(blank);
        setComments(n.comments || []);
        setCommentsDirty(false);
        setSaveState("idle");
        setMessages([
          {
            role: "ai",
            text: "我可以基于这篇笔记回答你的问题。试试问「这篇的核心结论是什么？」",
          },
        ]);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "加载失败"));
    api
      .getSettings()
      .then(setEngine)
      .catch(() => setEngineError(true));
    api.listFolders().then(setFoldersState).catch(() => {});
  }, [noteId]);

  useEffect(() => {
    const el = threadRef.current;
    if (el && typeof el.scrollTo === "function") {
      el.scrollTo({ top: el.scrollHeight });
    }
  }, [messages, typing]);

  // 阅读偏好持久化
  useEffect(() => {
    try {
      localStorage.setItem("rednoteReaderScale", String(readerScale));
    } catch {
      // 忽略存储异常
    }
  }, [readerScale]);

  // 注释改动后防抖自动保存
  useEffect(() => {
    if (!commentsDirty || !note) return;
    const snapshot = JSON.stringify(commentsRef.current);
    const timer = setTimeout(async () => {
      setSaveState("idle");
      const cleaned = commentsRef.current.filter(
        (c) => c.text.trim() || c.links.some((l) => l.url.trim())
      );
      try {
        await api.updateNote(note.id, { comments: cleaned });
        if (JSON.stringify(commentsRef.current) === snapshot) {
          setCommentsDirty(false);
          setSaveState("saved");
        }
        // 若保存期间又有新编辑，保留 dirty，下一轮继续自动保存
      } catch {
        setSaveState("error");
      }
    }, AUTOSAVE_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [commentsDirty, comments, note]);

  // “已自动保存”短暂提示后淡出
  useEffect(() => {
    if (saveState !== "saved") return;
    const t = setTimeout(() => setSaveState("idle"), 2400);
    return () => clearTimeout(t);
  }, [saveState]);

  // 新插入的卡片聚焦到输入框
  useEffect(() => {
    if (!focusCardId) return;
    const t = setTimeout(() => {
      const el = bodyRef.current?.querySelector<HTMLTextAreaElement>(
        `[data-cid="${focusCardId}"] textarea`
      );
      el?.focus();
      setFocusCardId(null);
    }, 30);
    return () => clearTimeout(t);
  }, [focusCardId]);

  // 关闭右键菜单
  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    window.addEventListener("pointerdown", close);
    return () => window.removeEventListener("pointerdown", close);
  }, [menu]);

  // 拖拽移动注释卡片
  useEffect(() => {
    if (!dragId) return;
    const container = bodyRef.current;
    if (!container) return;
    const rows = Array.from(container.querySelectorAll<HTMLElement>("[data-row]"));
    const line = lineRef.current;
    const dropSlot = { value: rows.length };

    const rowMid = (el: HTMLElement) => {
      const r = el.getBoundingClientRect();
      return r.top + r.height / 2;
    };

    const move = (e: PointerEvent) => {
      let slot = rows.length;
      for (let i = 0; i < rows.length; i += 1) {
        if (e.clientY < rowMid(rows[i])) {
          slot = i;
          break;
        }
      }
      dropSlot.value = slot;
      if (line) {
        const anchorEl = slot < rows.length ? rows[slot] : rows[rows.length - 1];
        const rect = anchorEl.getBoundingClientRect();
        const containerRect = container.getBoundingClientRect();
        line.style.top =
          slot < rows.length
            ? `${rect.top - containerRect.top - 2}px`
            : `${rect.bottom - containerRect.top - 2}px`;
        line.style.opacity = "1";
      }
    };

    const up = () => {
      const list = commentsRef.current;
      const next = relocateComment(list, dragId, dropSlot.value, blocksRef.current);
      setComments(next);
      setDragId(null);
      if (line) line.style.opacity = "0";
    };

    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up, { once: true });
    window.addEventListener("pointercancel", up, { once: true });
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dragId]);

  function startEdit() {
    if (!note) return;
    setDraftText(note.content);
    setTitleDraft(note.title);
    setSummaryDraft(note.summary || "");
    setPointDrafts(note.points || []);
    setEditing(true);
    setError("");
  }

  async function saveEdit() {
    if (!note) return;
    setSaving(true);
    setError("");
    try {
      const updated = await api.updateNote(note.id, {
        title: titleDraft.trim() || "无标题",
        summary: summaryDraft.trim(),
        content: draftText,
        points: pointDrafts.map((p) => p.trim()).filter(Boolean),
      });
      setNote(updated);
      setEditing(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存失败");
    } finally {
      setSaving(false);
    }
  }

  function patchPoint(index: number, value: string) {
    setPointDrafts((list) => list.map((p, i) => (i === index ? value : p)));
  }

  function addPoint() {
    setPointDrafts((list) => [...list, ""]);
  }

  function removePoint(index: number) {
    setPointDrafts((list) => list.filter((_, i) => i !== index));
  }

  async function addAttachmentFile(file: File | null) {
    if (!note || !file) return;
    setError("");
    try {
      const updated = await api.uploadAttachment(note.id, file);
      setNote(updated);
    } catch (e) {
      setError(e instanceof Error ? e.message : "上传失败");
    }
  }

  async function removeAttachment(token: string) {
    if (!note) return;
    if (!window.confirm("删除这个附件？原文件将从数据目录移除。")) return;
    try {
      await api.deleteAttachment(note.id, token);
      const updated = await api.getNote(note.id);
      if (updated) setNote(updated);
    } catch (e) {
      setError(e instanceof Error ? e.message : "删除失败");
    }
  }

  function copyNoteLink() {
    if (!note) return;
    const text = `[${note.title}](rednote://note/${note.id})`;
    const nav = navigator as Navigator & { clipboard?: { writeText: (t: string) => Promise<void> } };
    if (nav.clipboard?.writeText) {
      nav.clipboard.writeText(text).catch(() => {});
    }
  }

  /** 笔记正文里的互链点击：跳转到对应笔记 */
  function onNoteDocClick(e: ReactMouseEvent) {
    const anchor = (e.target as HTMLElement).closest<HTMLAnchorElement>('a[href^="rednote://note/"]');
    if (!anchor) return;
    e.preventDefault();
    const m = /rednote:\/\/note\/(\d+)/.exec(anchor.getAttribute("href") || "");
    if (m) openNote(Number(m[1]));
  }

  async function assignFolder(value: string) {
    if (!note) return;
    setError("");
    const folder_id = value === "" ? null : Number(value);
    try {
      const updated = await api.updateNote(note.id, { folder_id });
      setNote(updated);
      api.listFolders().then(setFoldersState).catch(() => {});
    } catch (e) {
      setError(e instanceof Error ? e.message : "收藏夹更新失败");
    }
  }

  async function removeNote() {
    if (!note) return;
    if (!window.confirm("把这篇笔记移入回收站？可随时从回收站恢复。")) return;
    try {
      await api.deleteNote(note.id);
      setView("library");
    } catch (e) {
      setError(e instanceof Error ? e.message : "删除失败");
    }
  }

  async function ask() {
    const q = question.trim();
    if (!q || !note || typing) return;
    setMessages((m) => [...m, { role: "user", text: q }]);
    setQuestion("");
    setTyping(true);
    try {
      const res = await api.ask(note.id, q);
      setMessages((m) => [...m, { role: "ai", text: res.answer }]);
    } catch (e) {
      setMessages((m) => [...m, { role: "ai", text: e instanceof Error ? e.message : "请求失败" }]);
    } finally {
      setTyping(false);
    }
  }

  // ------------------------------------------------ 注释编辑

  function touchComments(next: CommentCard[]) {
    setComments(next);
    setCommentsDirty(true);
    setSaveState("idle");
  }

  function addCommentAt(blockIndex: number) {
    if (!note) return;
    const id = newCardId();
    const blocks = splitBlocks(note.content).length;
    setComments((prev) => [
      ...prev,
      { id, text: "", links: [], anchor: Math.min(blockIndex, blocks - 1) },
    ]);
    setEditIds((prev) => new Set(prev).add(id));
    setCommentsDirty(true);
    setFocusCardId(id);
  }

  function enterEdit(id: string) {
    setEditIds((prev) => new Set(prev).add(id));
  }

  function exitEdit(id: string) {
    setEditIds((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }

  // 删除前先确认
  function askDelete(id: string) {
    setDelIds((prev) => new Set(prev).add(id));
  }

  function cancelDelete(id: string) {
    setDelIds((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }

  function confirmDelete(id: string) {
    removeComment(id);
    cancelDelete(id);
  }

  // 确认：立即保存并切换到“摘要卡片”阅读样式
  async function confirmComment(id: string) {
    if (!note) return;
    const card = commentsRef.current.find((c) => c.id === id);
    if (!card || (!card.text.trim() && card.links.length === 0)) {
      removeComment(id);
      return;
    }
    exitEdit(id);
    const snapshot = JSON.stringify(commentsRef.current);
    setSaveState("idle");
    try {
      const cleaned = commentsRef.current.filter(
        (c) => c.text.trim() || c.links.some((l) => l.url.trim())
      );
      await api.updateNote(note.id, { comments: cleaned });
      if (JSON.stringify(commentsRef.current) === snapshot) {
        setCommentsDirty(false);
        setSaveState("saved");
      }
    } catch {
      setSaveState("error");
    }
  }

  function removeComment(id: string) {
    touchComments(comments.filter((c) => c.id !== id));
  }

  function patchComment(id: string, patch: Partial<CommentCard>) {
    touchComments(comments.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  }

  function addLink(id: string) {
    touchComments(
      comments.map((c) => (c.id === id ? { ...c, links: [...c.links, { title: "", url: "" }] } : c))
    );
  }

  function patchLink(cardId: string, index: number, patch: Partial<{ title: string; url: string }>) {
    touchComments(
      comments.map((c) =>
        c.id === cardId
          ? { ...c, links: c.links.map((l, i) => (i === index ? { ...l, ...patch } : l)) }
          : c
      )
    );
  }

  function removeLink(cardId: string, index: number) {
    touchComments(
      comments.map((c) =>
        c.id === cardId ? { ...c, links: c.links.filter((_, i) => i !== index) } : c
      )
    );
  }

  // ------------------------------------------------ 选中段落 → Agent

  function onBodyMouseUp() {
    if (editing) return;
    const container = bodyRef.current;
    const sel = window.getSelection();
    const text = normalizedSelection(sel);
    if (!text || !container || !sel || sel.rangeCount === 0) return;
    const index = rowIndexOf(container, sel.anchorNode);
    if (index < 0) return;
    // 计算浮动条位置；部分环境(如测试 jsdom)Range 没有 getBoundingClientRect，给默认值
    let left = 8;
    let top = 8;
    const range = sel.rangeCount ? sel.getRangeAt(0) : null;
    const rectFn = (range as (Range & { getBoundingClientRect?: () => DOMRect }) | null)
      ?.getBoundingClientRect;
    if (range && typeof rectFn === "function") {
      try {
        const rect = rectFn.call(range);
        left = Math.max(8, rect.left);
        top = Math.max(8, rect.bottom + 8);
      } catch {
        // 保持默认位置
      }
    }
    setSeg({ x: left, y: top, index, text: text.slice(0, 6000) });
    setSegAsk(false);
    setSegAskQ("");
    setSegAnswer(null);
    setSegSaved(false);
  }

  function closeSeg() {
    setSeg(null);
    setSegAsk(false);
    setSegAnswer(null);
    setSegSaved(false);
  }

  async function runSeg(action: "explain" | "translate" | "ask", question = "") {
    if (!note || !seg || segBusy) return;
    setSegBusy(true);
    setSegAnswer(null);
    setSegSaved(false);
    try {
      const r = await api.agentSegment(note.id, seg.text, action, question);
      setSegAnswer(r.answer);
    } catch (e) {
      setSegAnswer(e instanceof Error ? e.message : "请求失败");
    } finally {
      setSegBusy(false);
    }
  }

  function copySegAnswer() {
    if (!segAnswer) return;
    const nav = navigator as Navigator & { clipboard?: { writeText: (t: string) => Promise<void> } };
    if (nav.clipboard?.writeText) {
      nav.clipboard.writeText(segAnswer).catch(() => {});
    }
  }

  function segToComment() {
    if (!note || !seg || !segAnswer) return;
    const id = newCardId();
    const total = splitBlocks(note.content).length;
    const card: CommentCard = {
      id,
      text: segAnswer,
      links: [],
      anchor: Math.min(seg.index, total - 1),
    };
    setComments((prev) => [...prev, card]);
    setCommentsDirty(true);
    setSegSaved(true);
  }

  if (!note) {
    return <div className="hint">加载中…</div>;
  }

  const engineCloud = engine !== null && sendsToCloud(engine);
  const engineText = engineError
    ? "引擎状态未知（默认本地规则）"
    : engine
      ? describeEngine(engine)
      : "";
  const showEngine = Boolean(engine || engineError);

  const blocks = splitBlocks(note.content);
  blocksRef.current = blocks.length;
  const rows = rowsFor(blocks.length, comments);
  const cardOrder = new Map<string, number>();
  comments.forEach((c, i) => cardOrder.set(c.id, i + 1));

  const outline = blocks
    .map((b, i) => (b.kind === "heading" ? { index: i, level: b.level, text: b.text } : null))
    .filter((x): x is { index: number; level: number; text: string } => x !== null);

  function jumpToSection(blockIndex: number) {
    const el = document.getElementById(`sec-${blockIndex}`);
    if (el && typeof el.scrollIntoView === "function") {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }

  function adjustScale(delta: number) {
    setReaderScale((s) => Math.min(1.6, Math.max(0.7, Math.round((s + delta) * 10) / 10)));
  }

  const menuBlock = menu
    ? menu.blockIndex < blocks.length
      ? blocks[menu.blockIndex]
      : null
    : null;

  return (
    <div className={`note-layout${outline.length > 0 ? " has-outline" : ""}`}>
      {outline.length > 0 && (
        <aside className="reader-rail" aria-label="文章目录">
          <div className="reader-rail-title">目录</div>
          {outline.map((o) => (
            <button
              key={o.index}
              className={`lv${Math.min(o.level, 6)}`}
              onClick={() => jumpToSection(o.index)}
            >
              {o.text}
            </button>
          ))}
        </aside>
      )}
      <div className="note-doc">
        <div className="note-actions-top">
          <button className="btn btn-ghost btn-sm" onClick={() => setView("library")}>
            ← 返回笔记库
          </button>
        </div>
        <div className="meta">
          {formatDate(note.created_at)} 保存
          {note.source_url && (
            <>
              {" · 来源 "}
              <a href={note.source_url} target="_blank" rel="noreferrer">
                {note.source_url}
              </a>
            </>
          )}
        </div>
        <h2>{note.title}</h2>
        <div className="folder-picker">
          <span className="lbl">收藏夹</span>
          <select
            aria-label="移动到收藏夹"
            value={note.folder_id === null ? "" : String(note.folder_id)}
            onChange={(e) => assignFolder(e.target.value)}
          >
            <option value="">未分类</option>
            {foldersState.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </select>
        </div>

        {error && (
          <div className="error-banner" role="alert">
            {error}
          </div>
        )}

        {note.summary && (
          <section className="note-summary" aria-label="摘要">
            <h4>摘要</h4>
            <p>{note.summary}</p>
          </section>
        )}
        {note.points.length > 0 && (
          <section className="note-summary" aria-label="要点">
            <h4>要点</h4>
            <ul>
              {note.points.map((p, i) => (
                <li key={i}>{p}</li>
              ))}
            </ul>
          </section>
        )}

        {editing ? (
          <div className="note-edit-panel">
            <label className="edit-field">
              <span>标题</span>
              <input
                type="text"
                value={titleDraft}
                onChange={(e) => setTitleDraft(e.target.value)}
                aria-label="笔记标题"
              />
            </label>
            <label className="edit-field">
              <span>摘要</span>
              <textarea
                value={summaryDraft}
                onChange={(e) => setSummaryDraft(e.target.value)}
                aria-label="笔记摘要"
                placeholder="一句话概括这篇笔记…（可留空）"
              />
            </label>
            <div className="edit-field">
              <span>要点</span>
              <div className="edit-points">
                {pointDrafts.map((p, i) => (
                  <div className="edit-point" key={i}>
                    <input
                      type="text"
                      value={p}
                      onChange={(e) => patchPoint(i, e.target.value)}
                      placeholder={`要点 ${i + 1}`}
                      aria-label={`要点${i + 1}`}
                    />
                    <button
                      className="chip-op danger"
                      aria-label={`删除要点${i + 1}`}
                      onClick={() => removePoint(i)}
                    >
                      ×
                    </button>
                  </div>
                ))}
                <button className="btn btn-ghost btn-sm" onClick={addPoint}>
                  ＋ 添加要点
                </button>
              </div>
            </div>
            <label className="edit-field">
              <span>正文</span>
              <textarea
                className="edit-content"
                value={draftText}
                onChange={(e) => setDraftText(e.target.value)}
                aria-label="笔记正文编辑区"
              />
            </label>
          </div>
        ) : (
          <div className="annotated-article" style={{ "--reader-scale": readerScale } as CSSProperties} data-testid="reader-article">
            <div className="reader-tools" role="toolbar" aria-label="阅读工具">
              <span className="reader-scale-tip">字号 {(readerScale * 100).toFixed(0)}%</span>
              <button aria-label="减小字号" onClick={() => adjustScale(-0.1)}>
                A−
              </button>
              <button aria-label="增大字号" onClick={() => adjustScale(0.1)}>
                A+
              </button>
              <span className="reader-tools-spacer" />
              {outline.length > 0 && <span className="reader-tools-count">目录在左侧 {outline.length} 节</span>}
            </div>

            <div className="annotate-bar">
              <span className="hint">
                {comments.length === 0
                  ? "提示：右键点击正文任意段落，可在该段落后插入注释"
                  : `正文中已插入 ${comments.length} 条注释（拖动手柄可移动到其他段落）`}
              </span>
              {(commentsDirty || saveState === "saved" || saveState === "error") && (
                <span className="save-state" role="status">
                  {saveState === "saved"
                    ? "已自动保存 ✓"
                    : saveState === "error"
                      ? "自动保存失败，继续编辑将重试"
                      : "编辑中…将自动保存"}
                </span>
              )}
            </div>

            <div
              ref={bodyRef}
              className={`body annotated${dragId ? " dragging" : ""}`}
              onClick={onNoteDocClick}
              onMouseUp={onBodyMouseUp}
              onContextMenu={(e) => {
                if (editing) return;
                e.preventDefault();
                const rowEl = (e.target as HTMLElement).closest<HTMLElement>("[data-row]");
                const key = rowEl?.dataset.row;
                const blockIndex = key?.startsWith("b") ? Number(key.slice(1)) : -1;
                if (blockIndex >= 0 && blockIndex < blocks.length) {
                  setMenu({ x: e.clientX, y: e.clientY, blockIndex });
                }
              }}
            >
              {rows.map((row) =>
                row.type === "block" ? (
                  <div
                    key={row.key}
                    data-row={row.key}
                    id={`sec-${row.index}`}
                    className={`article-block${menu?.blockIndex === row.index ? " ctx-target" : ""}`}
                  >
                    {renderOneBlock(blocks[row.index], row.index)}
                  </div>
                ) : (
                  (() => {
                    const card = comments.find((c) => `c:${c.id}` === row.key);
                    if (!card) return null;
                    const num = cardOrder.get(card.id) ?? 0;
                    if (editIds.has(card.id)) {
                      return (
                        <div
                          key={row.key}
                          data-row={row.key}
                          data-cid={card.id}
                          className={`inline-comment${dragId === card.id ? " dragging" : ""}`}
                        >
                          <div className="inline-comment-head">
                            <button
                              className="grip"
                              title="拖动移动到其他段落"
                              aria-label={`移动注释${num}`}
                              onPointerDown={(e) => {
                                e.preventDefault();
                                setDragId(card.id);
                              }}
                            >
                              ⣿
                            </button>
                            <span className="tag">第 {row.anchor + 1} 段批注</span>
                            <span className="spacer" />
                            {delIds.has(card.id) ? (
                              <span className="delete-confirm">
                                确定删除？
                                <button
                                  className="confirm yes"
                                  aria-label={`确认删除注释${num}`}
                                  onClick={() => confirmDelete(card.id)}
                                >
                                  删除
                                </button>
                                <button
                                  className="confirm no"
                                  aria-label={`取消删除注释${num}`}
                                  onClick={() => cancelDelete(card.id)}
                                >
                                  取消
                                </button>
                              </span>
                            ) : (
                              <button
                                className="head-btn danger"
                                aria-label={`删除注释${num}`}
                                onClick={() => askDelete(card.id)}
                              >
                                删除
                              </button>
                            )}
                          </div>
                          <textarea
                            value={card.text}
                            placeholder="写下你的注释/想法…"
                            aria-label={`注释${num}正文`}
                            onChange={(e) => patchComment(card.id, { text: e.target.value })}
                          />
                          {card.links.map((link, j) => (
                            <div className="cc-link" key={j}>
                              <input
                                type="text"
                                value={link.title}
                                placeholder="链接标题"
                                aria-label={`注释${num}链接${j + 1}标题`}
                                onChange={(e) => patchLink(card.id, j, { title: e.target.value })}
                              />
                              <input
                                type="url"
                                value={link.url}
                                placeholder="https://…"
                                aria-label={`注释${num}链接${j + 1}地址`}
                                onChange={(e) => patchLink(card.id, j, { url: e.target.value })}
                              />
                              <button
                                className="link-remove"
                                aria-label={`删除注释${num}的链接${j + 1}`}
                                onClick={() => removeLink(card.id, j)}
                              >
                                ×
                              </button>
                            </div>
                          ))}
                          <div className="cc-card-actions">
                            <button className="btn btn-ghost btn-sm" onClick={() => addLink(card.id)}>
                              ＋ 添加相关链接
                            </button>
                            <button
                              className="btn btn-primary btn-sm"
                              aria-label={`确认注释${num}`}
                              onClick={() => confirmComment(card.id)}
                            >
                              确认
                            </button>
                          </div>
                        </div>
                      );
                    }
                    return (
                      <div
                        key={row.key}
                        data-row={row.key}
                        data-cid={card.id}
                        className="note-summary annotate-view"
                      >
                        <div className="annotate-view-head">
                          {delIds.has(card.id) ? (
                            <div className="delete-confirm">
                              确定删除这条注释？
                              <button
                                className="confirm yes"
                                aria-label={`确认删除注释${num}`}
                                onClick={() => confirmDelete(card.id)}
                              >
                                删除
                              </button>
                              <button
                                className="confirm no"
                                aria-label={`取消删除注释${num}`}
                                onClick={() => cancelDelete(card.id)}
                              >
                                取消
                              </button>
                            </div>
                          ) : (
                            <div className="annotate-view-actions">
                              <button
                                aria-label={`编辑注释${num}`}
                                onClick={() => enterEdit(card.id)}
                              >
                                编辑
                              </button>
                              <button
                                className="danger"
                                aria-label={`删除注释${num}`}
                                onClick={() => askDelete(card.id)}
                              >
                                删除
                              </button>
                            </div>
                          )}
                        </div>
                        {card.text && <p>{card.text}</p>}
                        {card.links.length > 0 && (
                          <ul className="annotate-links">
                            {card.links.map((l, j) => (
                              <li key={j}>
                                <a href={l.url} target="_blank" rel="noreferrer">
                                  {l.title || l.url}
                                </a>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    );
                  })()
                )
              )}
              <div className="drop-line" ref={lineRef} aria-hidden="true" />
            </div>
          </div>
        )}

        {menu && (
          <div
            className="ctx-menu"
            style={{ left: menu.x, top: menu.y }}
            onPointerDown={(e) => e.stopPropagation()}
          >
            <div className="ctx-title">第 {menu.blockIndex + 1} 段</div>
            <button
              onClick={() => {
                addCommentAt(menu.blockIndex);
                setMenu(null);
              }}
            >
              在此段后插入注释
            </button>
            {menuBlock && (
              <div className="ctx-preview">{snippetOf(menuBlock).slice(0, 40)}</div>
            )}
          </div>
        )}

        {seg && !editing && (
          <div
            className="seg-pop"
            style={{ left: seg.x, top: seg.y }}
            onPointerDown={(e) => e.stopPropagation()}
            role="dialog"
            aria-label="选中段落操作"
          >
            <div className="seg-head">
              <span className="t">第 {seg.index + 1} 段 · 选中文字</span>
              <button className="x" aria-label="关闭选中操作" onClick={closeSeg}>
                ×
              </button>
            </div>
            <div className="seg-src" title={seg.text}>
              {seg.text.length > 220 ? `${seg.text.slice(0, 220)}…` : seg.text}
            </div>

            {segAnswer === null && !segAsk && !segBusy && (
              <div className="seg-btns">
                <button onClick={() => runSeg("explain")}>解释这段</button>
                <button onClick={() => runSeg("translate")}>翻译为中文</button>
                <button onClick={() => setSegAsk(true)}>追问细节</button>
              </div>
            )}

            {segAsk && !segBusy && (
              <div className="seg-ask">
                <input
                  autoFocus
                  value={segAskQ}
                  onChange={(e) => setSegAskQ(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      const q = segAskQ.trim();
                      if (q) runSeg("ask", q);
                    }
                  }}
                  placeholder="就这段文字问点什么…"
                  aria-label="追问输入"
                />
                <button
                  className="btn btn-sm btn-primary"
                  onClick={() => {
                    const q = segAskQ.trim();
                    if (q) runSeg("ask", q);
                  }}
                  disabled={!segAskQ.trim() || segBusy}
                >
                  追问
                </button>
              </div>
            )}

            {segBusy && <div className="seg-busy">正在调用模型…</div>}

            {segAnswer !== null && (
              <div className="seg-answer">
                <p>{segAnswer}</p>
                <div className="seg-actions">
                  <button className="btn btn-ghost btn-sm" onClick={copySegAnswer}>
                    复制
                  </button>
                  <button className="btn btn-ghost btn-sm" onClick={segToComment}>
                    存为注释
                  </button>
                  {segSaved && (
                    <span className="seg-saved">已追加到第 {seg.index + 1} 段批注 ✓</span>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {!editing && (
          <section className="note-attachments" aria-label="附件">
            <div className="att-head">
              <span className="lbl">附件（{note.files?.length ?? 0}）</span>
              <span className="spacer" />
              <label className="btn btn-ghost btn-sm att-add">
                添加文件
                <input
                  type="file"
                  accept=".pdf,.docx,.doc,.txt,.md,.epub,.csv,.xlsx,.pptx,.png,.jpg,.jpeg,.gif,.webp"
                  aria-label="添加附件"
                  onChange={(e) => {
                    const f = e.target.files?.[0] ?? null;
                    addAttachmentFile(f).finally(() => {
                      e.target.value = "";
                    });
                  }}
                />
              </label>
            </div>
            {!note.files || note.files.length === 0 ? (
              <p className="hint">把论文 PDF / DOCX 等原始文件归档到这里（存入数据目录，不随正文丢失）。</p>
            ) : (
              <ul className="att-list">
                {note.files.map((file) => (
                  <li key={file.id}>
                    <a href={`/api/notes/${note.id}/files/${file.id}`} download={file.name}>
                      {file.name}
                    </a>
                    <span className="att-meta">
                      {formatSize(file.size)} · {formatDate(file.added_at)}
                    </span>
                    <button
                      className="chip-op danger"
                      aria-label={`删除附件${file.name}`}
                      onClick={() => removeAttachment(file.id)}
                    >
                      ×
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

        <div className="note-actions">
          {editing ? (
            <button className="btn btn-primary" onClick={saveEdit} disabled={saving}>
              {saving ? "保存中…" : "保存修改"}
            </button>
          ) : (
            <button className="btn btn-ghost" onClick={startEdit}>
              编辑
            </button>
          )}
          {!editing && (
            <button className="btn btn-ghost" onClick={copyNoteLink}>
              复制笔记链接
            </button>
          )}
          <a
            className="btn btn-ghost"
            href={`/api/notes/${note.id}/export.md`}
            download={`note-${note.id}.md`}
          >
            导出 Markdown
          </a>
          <button className="btn btn-ghost danger" onClick={removeNote}>
            删除
          </button>
        </div>
      </div>

      <aside className="ask-panel">
        <div className="head">
          <span className="lbl">就这篇笔记追问</span>
        </div>
        {showEngine && (
          <div className={`engine-note${engineCloud ? " warn" : ""}`}>
            <span className="dot" />
            {engineText}
          </div>
        )}
        <div className="thread" ref={threadRef}>
          {messages.map((m, i) => (
            <div className={`msg ${m.role}`} key={i}>
              {m.text}
            </div>
          ))}
          {typing && (
            <div className="msg ai">
              <span className="typing">
                <span />
                <span />
                <span />
              </span>
            </div>
          )}
        </div>
        <div className="ask-input">
          <input
            type="text"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && ask()}
            placeholder="例如：这篇的核心结论是什么？"
            aria-label="输入问题"
          />
          <button className="send" onClick={ask} aria-label="发送" disabled={typing}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="m22 2-7 20-4-9-9-4Z" />
              <path d="M22 2 11 13" />
            </svg>
          </button>
        </div>
      </aside>
    </div>
  );
}
