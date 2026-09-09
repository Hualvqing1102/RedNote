import type {
  CollectResult,
  CommentCard,
  EventInput,
  EventItem,
  EventPatch,
  ExplainResult,
  Folder,
  Note,
  NoteInput,
  SettingsPatch,
  SettingsResponse,
  Summary,
} from "../types";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const isForm = init?.body instanceof FormData;
  const res = await fetch(path, {
    headers: isForm ? init?.headers : { "Content-Type": "application/json", ...init?.headers },
    ...init,
  });
  if (!res.ok) {
    let detail = `请求失败（${res.status}）`;
    try {
      const body = await res.json();
      if (body && typeof body.detail === "string") detail = body.detail;
    } catch {
      // 忽略解析失败，使用默认错误信息
    }
    throw new Error(detail);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export interface NoteFilter {
  q?: string;
  folder?: number;
  deleted?: boolean;
}

export type NotePatch = Partial<NoteInput> & { comments?: CommentCard[] };

export const api = {
  collectUrl: (url: string): Promise<CollectResult> =>
    request("/api/collect", { method: "POST", body: JSON.stringify({ url }) }),

  collectFile: (file: File, forceOcr = false): Promise<CollectResult> => {
    const fd = new FormData();
    fd.append("file", file, file.name);
    if (forceOcr) fd.append("force_ocr", "1");
    return request("/api/collect/file", { method: "POST", body: fd });
  },

  collectFilePath: (path: string, forceOcr = false): Promise<CollectResult> =>
    request("/api/collect/filepath", {
      method: "POST",
      body: JSON.stringify({ path, force_ocr: forceOcr }),
    }),

  summarize: (title: string, content: string): Promise<Summary> =>
    request("/api/agent/summarize", {
      method: "POST",
      body: JSON.stringify({ title, content }),
    }),

  explain: (title: string, content: string): Promise<ExplainResult> =>
    request("/api/agent/explain", {
      method: "POST",
      body: JSON.stringify({ title, content }),
    }),

  ask: (noteId: number, question: string): Promise<{ answer: string }> =>
    request("/api/agent/ask", {
      method: "POST",
      body: JSON.stringify({ note_id: noteId, question }),
    }),

  agentSegment: (
    noteId: number,
    text: string,
    action: "explain" | "translate" | "ask",
    question = ""
  ): Promise<{ answer: string }> =>
    request("/api/agent/segment", {
      method: "POST",
      body: JSON.stringify({ note_id: noteId, text, action, question }),
    }),

  listNotes: (filter: NoteFilter = {}): Promise<Note[]> => {
    const qs = new URLSearchParams();
    if (filter.q) qs.set("q", filter.q);
    if (typeof filter.folder === "number") qs.set("folder", String(filter.folder));
    if (filter.deleted) qs.set("deleted", "1");
    const suffix = qs.toString() ? `?${qs.toString()}` : "";
    return request(`/api/notes${suffix}`);
  },

  getNote: (id: number): Promise<Note> => request(`/api/notes/${id}`),

  createNote: (input: NoteInput): Promise<Note> =>
    request("/api/notes", { method: "POST", body: JSON.stringify(input) }),

  updateNote: (id: number, patch: NotePatch): Promise<Note> =>
    request(`/api/notes/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),

  deleteNote: (id: number): Promise<void> =>
    request(`/api/notes/${id}`, { method: "DELETE" }),

  restoreNote: (id: number): Promise<Note> =>
    request(`/api/notes/${id}/restore`, { method: "POST" }),

  purgeNote: (id: number): Promise<void> =>
    request(`/api/notes/${id}/purge`, { method: "DELETE" }),

  emptyTrash: (): Promise<{ removed: number }> =>
    request("/api/notes/trash/empty", { method: "POST" }),

  uploadAttachment: (noteId: number, file: File): Promise<Note> => {
    const fd = new FormData();
    fd.append("file", file, file.name);
    return request(`/api/notes/${noteId}/files`, { method: "POST", body: fd });
  },

  deleteAttachment: (noteId: number, token: string): Promise<void> =>
    request(`/api/notes/${noteId}/files/${token}`, { method: "DELETE" }),

  listFolders: (): Promise<Folder[]> => request("/api/folders"),

  createFolder: (name: string): Promise<Folder> =>
    request("/api/folders", { method: "POST", body: JSON.stringify({ name }) }),

  renameFolder: (id: number, name: string): Promise<Folder> =>
    request(`/api/folders/${id}`, { method: "PATCH", body: JSON.stringify({ name }) }),

  deleteFolder: (id: number): Promise<void> =>
    request(`/api/folders/${id}`, { method: "DELETE" }),

  listEvents: (start: number, end: number): Promise<EventItem[]> => {
    const qs = new URLSearchParams({
      start: String(start),
      end: String(end),
    });
    return request(`/api/events?${qs.toString()}`);
  },

  createEvent: (input: EventInput): Promise<EventItem> =>
    request("/api/events", { method: "POST", body: JSON.stringify(input) }),

  updateEvent: (id: number, patch: EventPatch): Promise<EventItem> =>
    request(`/api/events/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),

  deleteEvent: (id: number): Promise<void> =>
    request(`/api/events/${id}`, { method: "DELETE" }),

  getSettings: (): Promise<SettingsResponse> => request("/api/settings"),

  saveSettings: (patch: SettingsPatch): Promise<SettingsResponse> =>
    request("/api/settings", { method: "PUT", body: JSON.stringify(patch) }),

  testProvider: (cfg: {
    provider: string;
    base_url?: string;
    model?: string;
    api_key?: string;
  }): Promise<{ ok: boolean; reply: string }> =>
    request("/api/settings/test", { method: "POST", body: JSON.stringify(cfg) }),
};
