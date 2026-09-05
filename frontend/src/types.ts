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

export interface Note {
  id: number;
  title: string;
  summary: string;
  content: string;
  points: string[];
  comments?: CommentCard[];
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

export type ProviderName = "mock" | "claude" | "openai";

export interface ProviderGroupView {
  model?: string;
  base_url?: string;
  has_key: boolean;
}

export interface SettingsView {
  provider: ProviderName;
  claude: ProviderGroupView;
  openai: ProviderGroupView;
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
}
