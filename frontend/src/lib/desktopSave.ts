/**
 * 桌面版导出：走 pywebview 桌面壳的原生「另存为」通道。
 *
 * 为什么需要它：
 * 1) pywebview 默认禁止下载（settings['ALLOW_DOWNLOADS'] 为 False），桌面版里
 *    单纯依赖 <a download> 会被静默取消——没有对话框、没有文件、也没有报错；
 * 2) 即便下载能走通，文件名也只能是 note-<id>.md 这种无从辨认的名字。
 *
 * 这里的做法：前端先取到导出内容 → 转 base64 交给桌面桥（Python 侧 DesktopApi.save_file）
 * 弹原生「另存为」并落盘 → 把真实保存路径回显给用户。
 * 浏览器环境返回 null，由调用方回退到原来的 <a download> 行为。
 */

export interface SaveResult {
  ok: boolean;
  path?: string;
  bytes?: number;
  cancelled?: boolean;
  error?: string;
}

type SaveFileFn = (filename: string, contentB64: string) => Promise<SaveResult>;

interface PywebviewWindow {
  pywebview?: { api?: { save_file?: SaveFileFn } };
}

/** 取桌面桥的 save_file（浏览器里返回 null）。 */
export function desktopSaveFile(): SaveFileFn | null {
  if (typeof window === "undefined") return null;
  const api = (window as PywebviewWindow).pywebview?.api;
  if (!api || typeof api.save_file !== "function") return null;
  return api.save_file.bind(api);
}

/** 当前是否运行在桌面版（pywebview）里。 */
export function isDesktopApp(): boolean {
  return desktopSaveFile() !== null;
}

/** 清理出可安全用于文件名的标题：去掉 Windows 非法字符与首尾点号/空格，保留中文。 */
export function sanitizeTitle(title: string, fallback = "rednote-note"): string {
  const cleaned = (title || "")
    .replace(/[\\/:*?"<>|\r\n\t]/g, " ")
    .replace(/\s+/g, " ")
    .replace(/^[. ]+/, "")
    .replace(/[. ]+$/, "");
  return (cleaned || fallback).slice(0, 80);
}

/** 笔记标题 → 导出文件名（浏览器下载与桌面桥共用同一命名规则）。 */
export function noteExportName(title: string, noteId: number): string {
  return `${sanitizeTitle(title, `note-${noteId}`)}.md`;
}

/** 导出文件名里的日期戳，如 20260909。 */
export function dateStamp(date: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`;
}

/** 二进制内容 → base64（分块拼接，避免超长参数展开）。 */
function bytesToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

/**
 * 取导出内容并交给桌面桥保存。
 * @returns 桌面版返回保存结果；浏览器环境返回 null（调用方保持 <a download> 行为）。
 */
export async function saveExportViaDesktop(
  url: string,
  filename: string
): Promise<SaveResult | null> {
  const bridge = desktopSaveFile();
  if (!bridge) return null;

  const res = await fetch(url);
  if (!res.ok) throw new Error(`导出失败（${res.status}）`);
  return bridge(filename, bytesToBase64(await res.arrayBuffer()));
}

/** 把保存结果转成给用户看的一句话。 */
export function describeSaveResult(result: SaveResult, action = "导出"): string {
  if (result.cancelled) return "已取消保存";
  if (result.ok) return `已保存到 ${result.path}`;
  return `${action}失败：${result.error ?? "未知错误"}`;
}
