import { useAppStore, type View } from "./store/useAppStore";
import CalendarView from "./views/CalendarView";
import CollectView from "./views/CollectView";
import LibraryView from "./views/LibraryView";
import NoteView from "./views/NoteView";
import SettingsView from "./views/SettingsView";

const META: Record<View, { title: string; crumb: string }> = {
  collect: { title: "采集", crumb: "粘贴链接 → 提炼 → 保存" },
  library: { title: "笔记库", crumb: "搜索 · 筛选 · 删除" },
  note: { title: "笔记详情", crumb: "阅读 · 编辑 · 追问" },
  calendar: { title: "日历", crumb: "日程 · 待办" },
  settings: { title: "设置", crumb: "模型 Provider · API Key · 数据" },
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
  if (name === "settings") {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
      </svg>
    );
  }
  if (name === "calendar") {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="4.5" width="18" height="16" rx="2" />
        <path d="M8 2.5v4M16 2.5v4M3 9.5h18" />
        <path d="M8 14h.01M12 14h.01M16 14h.01M8 17.5h.01M12 17.5h.01" />
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
          <button
            className={`nav-item${view === "calendar" ? " active" : ""}`}
            onClick={() => setView("calendar")}
          >
            <NavIcon name="calendar" />
            <span>日历</span>
          </button>
          <button
            className={`nav-item${view === "settings" ? " active" : ""}`}
            onClick={() => setView("settings")}
          >
            <NavIcon name="settings" />
            <span>设置</span>
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
          {view === "calendar" && <CalendarView />}
          {view === "settings" && <SettingsView />}
        </div>
      </main>
    </div>
  );
}
