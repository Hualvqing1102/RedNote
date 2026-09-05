export interface Note {
  id: number;
  title: string;
  summary: string;
  content: string;
  points: string[];
  source_url: string;
  source_snapshot: string;
  created_at: number;
  updated_at: number;
  tags: string[];
}

export interface NoteInput {
  title: string;
  summary: string;
  content: string;
  points: string[];
  source_url: string;
  source_snapshot: string;
  tags: string[];
}

export interface CollectResult {
  title: string;
  content: string;
  source_url: string;
}

export interface Summary {
  title: string;
  summary: string;
  points: string[];
  tags: string[];
}
