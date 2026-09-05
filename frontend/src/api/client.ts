import type {
  CollectResult,
  Note,
  NoteInput,
  Summary,
} from "../types";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json" },
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
  tag?: string;
}

export const api = {
  collectUrl: (url: string): Promise<CollectResult> =>
    request("/api/collect", { method: "POST", body: JSON.stringify({ url }) }),

  summarize: (title: string, content: string): Promise<Summary> =>
    request("/api/agent/summarize", {
      method: "POST",
      body: JSON.stringify({ title, content }),
    }),

  ask: (noteId: number, question: string): Promise<{ answer: string }> =>
    request("/api/agent/ask", {
      method: "POST",
      body: JSON.stringify({ note_id: noteId, question }),
    }),

  listNotes: (filter: NoteFilter = {}): Promise<Note[]> => {
    const qs = new URLSearchParams();
    if (filter.q) qs.set("q", filter.q);
    if (filter.tag) qs.set("tag", filter.tag);
    const suffix = qs.toString() ? `?${qs.toString()}` : "";
    return request(`/api/notes${suffix}`);
  },

  getNote: (id: number): Promise<Note> => request(`/api/notes/${id}`),

  createNote: (input: NoteInput): Promise<Note> =>
    request("/api/notes", { method: "POST", body: JSON.stringify(input) }),

  updateNote: (id: number, patch: Partial<NoteInput>): Promise<Note> =>
    request(`/api/notes/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),

  deleteNote: (id: number): Promise<void> =>
    request(`/api/notes/${id}`, { method: "DELETE" }),

  listTags: (): Promise<string[]> => request("/api/tags"),
};
