import { create } from "zustand";

export type View = "collect" | "library" | "note";

interface AppState {
  view: View;
  activeNoteId: number | null;
  setView: (view: View) => void;
  openNote: (id: number) => void;
}

export const useAppStore = create<AppState>((set) => ({
  view: "collect",
  activeNoteId: null,
  setView: (view) => set({ view }),
  openNote: (id) => set({ view: "note", activeNoteId: id }),
}));
