import { useEffect, useState } from "react";
import { api } from "../api/client";
import ConfirmButton from "../components/ConfirmButton";
import { useAppStore } from "../store/useAppStore";
import type { Folder, Note } from "../types";

function formatDate(epoch: number): string {
  const d = new Date(epoch * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export default function LibraryView() {
  const openNote = useAppStore((s) => s.openNote);
  const [notes, setNotes] = useState<Note[]>([]);
  const [trashNotes, setTrashNotes] = useState<Note[]>([]);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [q, setQ] = useState("");
  const [folderId, setFolderId] = useState<number | null>(null); // null = 全部
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [managing, setManaging] = useState(false);
  const [inTrash, setInTrash] = useState(false);

  function refreshFolders() {
    api
      .listFolders()
      .then(setFolders)
      .catch(() => setError("收藏夹加载失败"));
  }

  useEffect(() => {
    refreshFolders();
  }, []);

  useEffect(() => {
    if (inTrash) {
      api
        .listNotes({ deleted: true })
        .then(setTrashNotes)
        .catch(() => setError("回收站加载失败"));
      return;
    }
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const list = await api.listNotes({
          q: q.trim() || undefined,
          folder: folderId ?? undefined,
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
  }, [q, folderId, inTrash]);

  async function removeNote(id: number) {
    try {
      await api.deleteNote(id);
      setNotes((list) => list.filter((n) => n.id !== id));
    } catch (e) {
      setError(e instanceof Error ? e.message : "删除失败");
    }
  }

  async function restoreFromTrash(id: number) {
    try {
      await api.restoreNote(id);
      setTrashNotes((list) => list.filter((n) => n.id !== id));
    } catch (e) {
      setError(e instanceof Error ? e.message : "恢复失败");
    }
  }

  async function purgeNote(id: number) {
    try {
      await api.purgeNote(id);
      setTrashNotes((list) => list.filter((n) => n.id !== id));
    } catch (e) {
      setError(e instanceof Error ? e.message : "删除失败");
    }
  }

  async function emptyTrash() {
    try {
      await api.emptyTrash();
      setTrashNotes([]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "清空失败");
    }
  }

  async function createBlankNote() {
    setError("");
    try {
      const note = await api.createNote({
        title: "无标题",
        summary: "",
        content: "",
        points: [],
        source_url: "",
        source_snapshot: "",
      });
      openNote(note.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "新建失败");
    }
  }

  async function moveNote(id: number, value: string) {
    const folder_id = value === "" ? null : Number(value);
    try {
      const updated = await api.updateNote(id, { folder_id });
      // 当前正按某收藏夹浏览时，把移出的笔记从列表移除
      setNotes((list) =>
        folderId !== null && updated.folder_id !== folderId
          ? list.filter((n) => n.id !== id)
          : list.map((n) => (n.id === id ? updated : n))
      );
      setError("");
      refreshFolders();
    } catch (e) {
      setError(e instanceof Error ? e.message : "移动失败");
    }
  }

  async function submitCreate() {
    const name = newName.trim();
    if (!name) return;
    try {
      await api.createFolder(name);
      setNewName("");
      setCreating(false);
      refreshFolders();
    } catch (e) {
      setError(e instanceof Error ? e.message : "创建失败");
    }
  }

  async function renameFolder(folder: Folder) {
    const name = window.prompt("重命名收藏夹", folder.name);
    if (!name || !name.trim()) return;
    try {
      await api.renameFolder(folder.id, name.trim());
      refreshFolders();
    } catch (e) {
      setError(e instanceof Error ? e.message : "重命名失败");
    }
  }

  async function removeFolder(folder: Folder) {
    try {
      await api.deleteFolder(folder.id);
      if (folderId === folder.id) setFolderId(null);
      refreshFolders();
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
        <a
          className="btn btn-ghost btn-sm export-link"
          href="/api/export/notes.md"
          download="rednote-notes.md"
        >
          导出全部 Markdown
        </a>
        <button className="btn btn-primary btn-sm" onClick={createBlankNote}>
          ＋ 新建笔记
        </button>
        <button
          className={`btn btn-ghost btn-sm${inTrash ? " toggle-on" : ""}`}
          aria-pressed={inTrash}
          onClick={() => {
            setInTrash((v) => !v);
            setManaging(false);
          }}
        >
          {inTrash ? "← 返回笔记" : "回收站"}
        </button>
      </div>

      {inTrash ? (
        <>
          <div className="filters">
            <span className="hint">回收站：已删除的笔记可恢复，或彻底删除</span>
            <span className="spacer" />
            {trashNotes.length > 0 && (
              <ConfirmButton
                className="btn btn-ghost btn-sm"
                confirmLabel="确认清空"
                onConfirm={emptyTrash}
              >
                清空回收站
              </ConfirmButton>
            )}
          </div>
          {error && (
            <div className="error-banner" role="alert">
              {error}
            </div>
          )}
          {trashNotes.length === 0 ? (
            <div className="empty">
              <div className="big">回收站是空的</div>
              <p>删除的笔记会先到这里，可随时恢复。</p>
            </div>
          ) : (
            <div className="cards">
              {trashNotes.map((note) => (
                <article className="note-card trashed" key={note.id}>
                  <div className="tab" />
                  <div className="kind">回收站 · {formatDate(note.deleted_at ?? note.created_at)}</div>
                  <h3>{note.title}</h3>
                  <div className="snippet">{note.summary || note.content.slice(0, 120)}</div>
                  <div className="trash-actions">
                    <button
                      className="btn btn-primary btn-sm"
                      onClick={() => restoreFromTrash(note.id)}
                    >
                      恢复
                    </button>
                    <ConfirmButton
                      className="btn btn-ghost btn-sm"
                      confirmLabel="确认彻底删除"
                      onConfirm={() => purgeNote(note.id)}
                    >
                      彻底删除
                    </ConfirmButton>
                  </div>
                </article>
              ))}
            </div>
          )}
        </>
      ) : (
        <>
      <div className="filters" aria-label="收藏夹筛选">
        <button
          className={`fchip${folderId === null ? " active" : ""}`}
          onClick={() => {
            setFolderId(null);
            setManaging(false);
          }}
        >
          全部
        </button>
        {folders.map((f) => (
          <span className="folder-chip-wrap" key={f.id}>
            <button
              className={`fchip${folderId === f.id ? " active" : ""}`}
              onClick={() => {
                setFolderId(f.id);
                setManaging(false);
              }}
              title={`${f.name}（${f.note_count} 篇）`}
            >
              {f.name}
              <span className="chip-count">{f.note_count}</span>
            </button>
            {managing && (
              <>
                <button
                  className="chip-op"
                  aria-label={`重命名收藏夹${f.name}`}
                  title="重命名"
                  onClick={() => renameFolder(f)}
                >
                  ✎
                </button>
                <ConfirmButton
                  className="chip-op"
                  title="删除"
                  ariaLabel={`删除收藏夹${f.name}`}
                  confirmLabel="确认删除"
                  onConfirm={() => removeFolder(f)}
                >
                  ×
                </ConfirmButton>
              </>
            )}
          </span>
        ))}
        {creating ? (
          <span className="folder-create">
            <input
              value={newName}
              autoFocus
              placeholder="收藏夹名称"
              aria-label="新收藏夹名称"
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && submitCreate()}
            />
            <button className="btn btn-primary btn-sm" onClick={submitCreate}>
              确定
            </button>
            <button className="btn btn-ghost btn-sm" onClick={() => setCreating(false)}>
              取消
            </button>
          </span>
        ) : (
          <button className="fchip add-folder" onClick={() => setCreating(true)}>
            ＋ 新建收藏夹
          </button>
        )}
        {folders.length > 0 && (
          <button
            className="btn btn-ghost btn-sm manage-folder"
            aria-pressed={managing}
            onClick={() => setManaging((m) => !m)}
          >
            {managing ? "完成" : "管理"}
          </button>
        )}
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
          <p>换个关键词或收藏夹，或去「采集」页新增一篇。</p>
        </div>
      ) : (
        <div className="cards">
          {notes.map((note) => (
            <article className="note-card" key={note.id} onClick={() => openNote(note.id)}>
              <div className="tab" />
              <div className="kind">笔记 · {formatDate(note.created_at)}</div>
              <h3>{note.title}</h3>
              <div className="snippet">{note.summary || note.content.slice(0, 120)}</div>
              <div className="meta">
                <span className="src">{note.source_url || "无来源"}</span>
                <span>{note.points.length} 要点</span>
              </div>
              <div className="note-folder" onClick={(e) => e.stopPropagation()}>
                <select
                  aria-label={`设置笔记「${note.title}」的收藏夹`}
                  value={note.folder_id === null ? "" : String(note.folder_id)}
                  onChange={(e) => moveNote(note.id, e.target.value)}
                >
                  <option value="">未分类</option>
                  {folders.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.name}
                    </option>
                  ))}
                </select>
              </div>
              <ConfirmButton
                className="card-delete"
                title="移入回收站"
                confirmLabel="确认删除"
                onConfirm={() => removeNote(note.id)}
              >
                删除
              </ConfirmButton>
            </article>
          ))}
        </div>
      )}
      </>
      )}
    </div>
  );
}
