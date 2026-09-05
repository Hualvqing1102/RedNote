import { useEffect, useRef, useState } from "react";
import { api } from "../api/client";
import { describeEngine, sendsToCloud } from "../lib/provider";
import { renderBlocks } from "../lib/markdown";
import { useAppStore } from "../store/useAppStore";
import type { CommentCard, Note, SettingsResponse } from "../types";

interface Msg {
  role: "user" | "ai";
  text: string;
}

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

export default function NoteView() {
  const noteId = useAppStore((s) => s.activeNoteId);
  const setView = useAppStore((s) => s.setView);

  const [note, setNote] = useState<Note | null>(null);
  const [editing, setEditing] = useState(false);
  const [draftText, setDraftText] = useState("");
  const [saving, setSaving] = useState(false);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [question, setQuestion] = useState("");
  const [typing, setTyping] = useState(false);
  const [error, setError] = useState("");
  const [engine, setEngine] = useState<SettingsResponse | null>(null);
  const [engineError, setEngineError] = useState(false);
  // 注释卡片(独立面板，可增删/排序)
  const [comments, setComments] = useState<CommentCard[]>([]);
  const [commentsDirty, setCommentsDirty] = useState(false);
  const [savingComments, setSavingComments] = useState(false);
  const [commentsMsg, setCommentsMsg] = useState("");
  const threadRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!noteId) return;
    api
      .getNote(noteId)
      .then((n) => {
        setNote(n);
        setDraftText(n.content);
        setEditing(false);
        setComments(n.comments || []);
        setCommentsDirty(false);
        setCommentsMsg("");
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
  }, [noteId]);

  useEffect(() => {
    const el = threadRef.current;
    if (el && typeof el.scrollTo === "function") {
      el.scrollTo({ top: el.scrollHeight });
    }
  }, [messages, typing]);

  async function saveEdit() {
    if (!note) return;
    setSaving(true);
    setError("");
    try {
      const updated = await api.updateNote(note.id, { content: draftText });
      setNote(updated);
      setEditing(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存失败");
    } finally {
      setSaving(false);
    }
  }

  async function removeNote() {
    if (!note) return;
    if (!window.confirm("确定删除这篇笔记吗？此操作不可恢复。")) return;
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

  // ------------------------------------------------ 注释卡片

  function touchComments(next: CommentCard[]) {
    setComments(next);
    setCommentsDirty(true);
    setCommentsMsg("");
  }

  function addComment() {
    touchComments([...comments, { id: newCardId(), text: "", links: [] }]);
  }

  function removeComment(id: string) {
    touchComments(comments.filter((c) => c.id !== id));
  }

  function moveComment(index: number, dir: -1 | 1) {
    const target = index + dir;
    if (target < 0 || target >= comments.length) return;
    const next = [...comments];
    [next[index], next[target]] = [next[target], next[index]];
    touchComments(next);
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

  async function saveComments() {
    if (!note) return;
    setSavingComments(true);
    setCommentsMsg("");
    try {
      const updated = await api.updateNote(note.id, { comments });
      setNote(updated);
      setComments(updated.comments || []);
      setCommentsDirty(false);
      setCommentsMsg("注释已保存");
    } catch (e) {
      setCommentsMsg(e instanceof Error ? e.message : "保存失败");
    } finally {
      setSavingComments(false);
    }
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

  return (
    <div className="note-layout">
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
        {note.tags.length > 0 && (
          <div className="tag-row">
            {note.tags.map((t) => (
              <span className="tag" key={t}>
                {t}
              </span>
            ))}
          </div>
        )}

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
          <textarea
            value={draftText}
            onChange={(e) => setDraftText(e.target.value)}
            aria-label="笔记正文编辑区"
          />
        ) : (
          <div className="body">{renderBlocks(note.content)}</div>
        )}

        <div className="note-actions">
          {editing ? (
            <button className="btn btn-primary" onClick={saveEdit} disabled={saving}>
              {saving ? "保存中…" : "保存修改"}
            </button>
          ) : (
            <button className="btn btn-ghost" onClick={() => setEditing(true)}>
              编辑
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

        <section className="note-comments" aria-label="我的注释与相关链接">
          <h4>我的注释与相关链接</h4>
          <p className="hint">把阅读时的想法记下来，或补充相关延伸阅读链接；卡片可增删、可上下排序。</p>

          {commentsMsg && (
            <div className={`comments-msg${commentsMsg.includes("已保存") ? "" : " error"}`} role="status">
              {commentsMsg}
            </div>
          )}

          {comments.length === 0 ? (
            <div className="comments-empty">
              还没有注释。点击「＋ 添加注释卡片」在你想记录的位置插入一张卡片。
            </div>
          ) : (
            <div className="comment-list">
              {comments.map((card, i) => (
                <article className="comment-card" key={card.id}>
                  <div className="cc-bar">
                    <span className="cc-no">#{i + 1}</span>
                    <div className="cc-tools">
                      <button
                        aria-label={`上移注释${i + 1}`}
                        disabled={i === 0}
                        onClick={() => moveComment(i, -1)}
                      >
                        ↑
                      </button>
                      <button
                        aria-label={`下移注释${i + 1}`}
                        disabled={i === comments.length - 1}
                        onClick={() => moveComment(i, 1)}
                      >
                        ↓
                      </button>
                      <button
                        className="danger"
                        aria-label={`删除注释${i + 1}`}
                        onClick={() => removeComment(card.id)}
                      >
                        删除
                      </button>
                    </div>
                  </div>

                  <textarea
                    value={card.text}
                    placeholder="写下你的注释/想法…"
                    aria-label={`注释${i + 1}正文`}
                    onChange={(e) => patchComment(card.id, { text: e.target.value })}
                  />

                  {card.links.map((link, j) => (
                    <div className="cc-link" key={j}>
                      <input
                        type="text"
                        value={link.title}
                        placeholder="链接标题"
                        aria-label={`注释${i + 1}链接${j + 1}标题`}
                        onChange={(e) => patchLink(card.id, j, { title: e.target.value })}
                      />
                      <input
                        type="url"
                        value={link.url}
                        placeholder="https://…"
                        aria-label={`注释${i + 1}链接${j + 1}地址`}
                        onChange={(e) => patchLink(card.id, j, { url: e.target.value })}
                      />
                      <button
                        className="link-remove"
                        aria-label={`删除注释${i + 1}的链接${j + 1}`}
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
                  </div>
                </article>
              ))}
            </div>
          )}

          <div className="comment-actions">
            <button className="btn btn-ghost btn-sm" onClick={addComment}>
              ＋ 添加注释卡片
            </button>
            {commentsDirty && (
              <button
                className="btn btn-primary btn-sm"
                onClick={saveComments}
                disabled={savingComments}
              >
                {savingComments ? "保存中…" : "保存注释"}
              </button>
            )}
          </div>
        </section>
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
