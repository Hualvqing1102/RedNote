import { useAppStore, type View } from "./store/useAppStore";
import CollectView from "./views/CollectView";
import LibraryView from "./views/LibraryView";
import NoteView from "./views/NoteView";

const META: Record<View, { title: string; crumb: string }> = {
  collect: { title: "采集", crumb: "粘贴链接 → 提炼 → 保存" },
  library: { title: "笔记库", crumb: "搜索 · 筛选 · 删除" },
  note: { title: "笔记详情", crumb: "阅读 · 编辑 · 追问" },
};

function NavIcon({ name }: { name: View }) {
  if (name === "collect") {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7" />
        <path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="7" width="13" height="13" rx="2" />
      <path d="M8 7V5a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-2" />
    </svg>
  );
}

export default function App() {
  const view = useAppStore((s) => s.view);
  const setView = useAppStore((s) => s.setView);
  const meta = META[view];

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">R</div>
          <div>
            <div className="brand-name">RedNote</div>
            <div className="brand-sub">LOCAL STUDY NOTES</div>
          </div>
        </div>

        <nav className="nav">
          <button
            className={`nav-item${view === "collect" ? " active" : ""}`}
            onClick={() => setView("collect")}
          >
            <NavIcon name="collect" />
            <span>采集</span>
          </button>
          <button
            className={`nav-item${view === "library" ? " active" : ""}`}
            onClick={() => setView("library")}
          >
            <NavIcon name="library" />
            <span>笔记库</span>
          </button>
        </nav>

        <div className="sidebar-foot">
          <span className="dot" />
          本地存储 · 数据不出本机
          <br />
          笔记为 Markdown · 可导出备份
        </div>
      </aside>

      <main className="main">
        <header className="topbar">
          <div>
            <h1>{meta.title}</h1>
            <div className="crumb">{meta.crumb}</div>
          </div>
          <div className="topbar-actions">
            {view === "library" && (
              <button className="btn btn-ghost btn-sm" onClick={() => setView("collect")}>
                + 采集新内容
              </button>
            )}
          </div>
        </header>

        <div className="content">
          {view === "collect" && <CollectView />}
          {view === "library" && <LibraryView />}
          {view === "note" && <NoteView />}
        </div>
      </main>
    </div>
  );
}
