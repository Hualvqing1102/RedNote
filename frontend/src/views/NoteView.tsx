import { useEffect, useRef, useState } from "react";
import { api } from "../api/client";
import { renderBlocks } from "../lib/markdown";
import { useAppStore } from "../store/useAppStore";
import type { Note } from "../types";

interface Msg {
  role: "user" | "ai";
  text: string;
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
  const threadRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!noteId) return;
    api
      .getNote(noteId)
      .then((n) => {
        setNote(n);
        setDraftText(n.content);
        setEditing(false);
        setMessages([
          {
            role: "ai",
            text: "我可以基于这篇笔记回答你的问题。试试问「这篇的核心结论是什么？」",
          },
        ]);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "加载失败"));
  }, [noteId]);

  useEffect(() => {
    threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight });
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

  if (!note) {
    return <div className="hint">加载中…</div>;
  }

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
          <button className="btn btn-ghost danger" onClick={removeNote}>
            删除
          </button>
        </div>
      </div>

      <aside className="ask-panel">
        <div className="head">
          <span className="lbl">就这篇笔记追问</span>
        </div>
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
