export interface CommentLink {
  title: string;
  url: string;
}

export interface CommentCard {
  id: string;
  text: string;
  links: CommentLink[];
  /** 锚定段落序号：0 = 第 1 段；缺省时显示在全文末尾段落之后 */
  anchor?: number;
}

export interface Folder {
  id: number;
  name: string;
  note_count: number;
}

export type EventKind = "schedule" | "todo";
export type EventColor = "green" | "blue" | "yellow" | "pink" | "purple";
export type EventRecur = "none" | "weekly";

export interface EventItem {
  id: number;
  title: string;
  kind: EventKind;
  color: EventColor;
  recur: EventRecur;
  start_ts: number;
  end_ts: number | null;
  all_day: boolean;
  done: boolean;
  note_id: number | null;
  created_at: number;
  updated_at: number;
}

export interface EventInput {
  title: string;
  kind: EventKind;
  color?: EventColor;
  recur?: EventRecur;
  start_ts: number;
  end_ts?: number | null;
  all_day?: boolean;
  done?: boolean;
}

export type EventPatch = Partial<EventInput>;

export interface Note {
  id: number;
  title: string;
  summary: string;
  content: string;
  points: string[];
  comments?: CommentCard[];
  source_url: string;
  source_snapshot: string;
  folder_id: number | null;
  folder_name?: string;
  created_at: number;
  updated_at: number;
}

export interface NoteInput {
  title: string;
  summary: string;
  content: string;
  points: string[];
  comments?: CommentCard[];
  source_url: string;
  source_snapshot: string;
  folder_id?: number | null;
}

export interface CollectResult {
  title: string;
  content: string;
  source_url: string;
  /** 本地文档导入时的原始文件名 */
  filename?: string;
}

export interface Summary {
  title: string;
  summary: string;
  points: string[];
}

export interface ExplainResult {
  title: string;
  explanation: string;
}

export type ProviderName = "mock" | "claude" | "openai" | "deepseek" | "qwen";

export interface ProviderGroupView {
  model?: string;
  base_url?: string;
  has_key: boolean;
}

export interface SettingsView {
  provider: ProviderName;
  claude: ProviderGroupView;
  openai: ProviderGroupView;
  deepseek: ProviderGroupView;
  qwen: ProviderGroupView;
}

export interface SettingsActive {
  provider: ProviderName;
  available: boolean;
}

export interface SettingsResponse {
  settings: SettingsView;
  active: SettingsActive;
}

export interface SettingsPatch {
  provider?: ProviderName;
  claude?: { model?: string; api_key?: string };
  openai?: { base_url?: string; model?: string; api_key?: string };
  deepseek?: { base_url?: string; model?: string; api_key?: string };
  qwen?: { base_url?: string; model?: string; api_key?: string };
}
