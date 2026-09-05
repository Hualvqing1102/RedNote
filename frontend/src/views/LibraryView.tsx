import { useEffect, useState } from "react";
import { api } from "../api/client";
import { useAppStore } from "../store/useAppStore";
import type { Note } from "../types";

function formatDate(epoch: number): string {
  const d = new Date(epoch * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export default function LibraryView() {
  const openNote = useAppStore((s) => s.openNote);
  const [notes, setNotes] = useState<Note[]>([]);
  const [tags, setTags] = useState<string[]>([]);
  const [q, setQ] = useState("");
  const [tag, setTag] = useState("全部");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    api.listTags().then(setTags).catch(() => {});
  }, []);

  useEffect(() => {
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const list = await api.listNotes({
          q: q.trim() || undefined,
          tag: tag === "全部" ? undefined : tag,
        });
        setNotes(list);
        setError("");
      } catch (e) {
        setError(e instanceof Error ? e.message : "加载失败");
      } finally {
        setLoading(false);
      }
    }, q ? 200 : 0);
    return () => clearTimeout(timer);
  }, [q, tag]);

  async function removeNote(id: number) {
    if (!window.confirm("确定删除这篇笔记吗？此操作不可恢复。")) return;
    try {
      await api.deleteNote(id);
      setNotes((list) => list.filter((n) => n.id !== id));
    } catch (e) {
      setError(e instanceof Error ? e.message : "删除失败");
    }
  }

  return (
    <div>
      <div className="lib-tools">
        <div className="search">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.2-3.2" />
          </svg>
          <input
            type="text"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="搜索标题、摘要或正文…"
            aria-label="搜索笔记"
          />
        </div>
        <div className="filters">
          {["全部", ...tags].map((t) => (
            <button
              key={t}
              className={`fchip${tag === t ? " active" : ""}`}
              onClick={() => setTag(t)}
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div className="error-banner" role="alert">
          {error}
        </div>
      )}

      {loading ? (
        <div className="hint">加载中…</div>
      ) : notes.length === 0 ? (
        <div className="empty">
          <div className="big">没有匹配的笔记</div>
          <p>换个关键词或筛选条件，或去「采集」页新增一篇。</p>
        </div>
      ) : (
        <div className="cards">
          {notes.map((note) => (
            <article className="note-card" key={note.id} onClick={() => openNote(note.id)}>
              <div className="tab" />
              <div className="kind">笔记 · {formatDate(note.created_at)}</div>
              <h3>{note.title}</h3>
              <div className="snippet">{note.summary || note.content.slice(0, 120)}</div>
              {note.tags.length > 0 && (
                <div className="tags">
                  {note.tags.map((t) => (
                    <span className="tag" key={t}>
                      {t}
                    </span>
                  ))}
                </div>
              )}
              <div className="meta">
                <span className="src">{note.source_url || "无来源"}</span>
                <span>{note.points.length} 要点</span>
              </div>
              <button
                className="card-delete"
                title="删除笔记"
                onClick={(e) => {
                  e.stopPropagation();
                  removeNote(note.id);
                }}
              >
                删除
              </button>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
