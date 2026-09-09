import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../api/client";
import { useAppStore } from "../store/useAppStore";
import LibraryView from "./LibraryView";
import type { Note } from "../types";

vi.mock("../api/client", () => ({
  api: {
    listNotes: vi.fn(),
    listFolders: vi.fn(),
    createNote: vi.fn(),
    deleteNote: vi.fn(),
    restoreNote: vi.fn(),
    purgeNote: vi.fn(),
    emptyTrash: vi.fn(),
    updateNote: vi.fn(),
  },
}));

function note(id: number, title: string, deleted = false): Note {
  return {
    id,
    title,
    summary: "",
    content: "正文内容",
    points: [],
    comments: [],
    source_url: "",
    source_snapshot: "",
    folder_id: null,
    deleted,
    deleted_at: deleted ? 1700000000 : null,
    files: [],
    created_at: 1700000000,
    updated_at: 1700000000,
  };
}

describe("LibraryView 新建笔记与回收站", () => {
  beforeEach(() => {
    useAppStore.setState({ view: "library", activeNoteId: null });
    vi.mocked(api.listFolders).mockReset().mockResolvedValue([]);
    vi.mocked(api.listNotes).mockReset().mockImplementation(async (filter) => {
      if (filter?.deleted) {
        return [note(2, "已删除的笔记", true)];
      }
      return [note(1, "Transformer 笔记")];
    });
    vi.mocked(api.createNote).mockReset().mockResolvedValue(note(9, "无标题"));
    vi.mocked(api.deleteNote).mockReset().mockResolvedValue(undefined);
    vi.mocked(api.restoreNote).mockReset().mockResolvedValue(note(2, "已删除的笔记"));
    vi.mocked(api.purgeNote).mockReset().mockResolvedValue(undefined);
    vi.mocked(api.emptyTrash).mockReset().mockResolvedValue({ removed: 1 });
  });

  it("＋ 新建笔记：创建空白笔记并打开", async () => {
    render(<LibraryView />);
    await screen.findByText("Transformer 笔记");
    fireEvent.click(screen.getByRole("button", { name: "＋ 新建笔记" }));

    await waitFor(() => {
      expect(api.createNote).toHaveBeenCalledWith(
        expect.objectContaining({ title: "无标题", content: "", summary: "" })
      );
      expect(useAppStore.getState()).toMatchObject({ view: "note", activeNoteId: 9 });
    });
  });

  it("回收站：列出已删除笔记并可恢复", async () => {
    render(<LibraryView />);
    await screen.findByText("Transformer 笔记");
    fireEvent.click(screen.getByRole("button", { name: "回收站" }));

    expect(await screen.findByText("已删除的笔记")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "恢复" }));
    await waitFor(() => expect(api.restoreNote).toHaveBeenCalledWith(2));
    expect(screen.queryByText("已删除的笔记")).not.toBeInTheDocument();
  });

  it("回收站：可彻底删除单篇(需两步确认)", async () => {
    render(<LibraryView />);
    await screen.findByText("Transformer 笔记");
    fireEvent.click(screen.getByRole("button", { name: "回收站" }));
    await screen.findByText("已删除的笔记");

    fireEvent.click(screen.getByRole("button", { name: "彻底删除" }));
    fireEvent.click(screen.getByRole("button", { name: "确认彻底删除" }));
    await waitFor(() => expect(api.purgeNote).toHaveBeenCalledWith(2));
    expect(screen.queryByText("已删除的笔记")).not.toBeInTheDocument();
  });

  it("回收站：可一键清空(需两步确认)", async () => {
    render(<LibraryView />);
    await screen.findByText("Transformer 笔记");
    fireEvent.click(screen.getByRole("button", { name: "回收站" }));
    await screen.findByText("已删除的笔记");

    fireEvent.click(screen.getByRole("button", { name: "清空回收站" }));
    fireEvent.click(screen.getByRole("button", { name: "确认清空" }));
    await waitFor(() => expect(api.emptyTrash).toHaveBeenCalled());
    expect(screen.queryByText("已删除的笔记")).not.toBeInTheDocument();
  });
});
