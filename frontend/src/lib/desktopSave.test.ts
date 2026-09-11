import { afterEach, describe, expect, it, vi } from "vitest";
import {
  dateStamp,
  describeSaveResult,
  desktopSaveFile,
  isDesktopApp,
  noteExportName,
  sanitizeTitle,
  saveExportViaDesktop,
} from "./desktopSave";

type AnyWindow = Window & { pywebview?: unknown };

function setBridge(api: unknown): void {
  (window as AnyWindow).pywebview = api === undefined ? undefined : { api };
}

afterEach(() => {
  setBridge(undefined);
  vi.restoreAllMocks();
});

describe("desktopSave", () => {
  it("浏览器环境：无桌面桥", () => {
    expect(desktopSaveFile()).toBeNull();
    expect(isDesktopApp()).toBe(false);
  });

  it("桌面环境：识别出 save_file", () => {
    const save_file = vi.fn();
    setBridge({ save_file });
    expect(isDesktopApp()).toBe(true);
    expect(desktopSaveFile()).toBeTypeOf("function");
  });

  it("有 api 但缺 save_file 时视为浏览器环境", () => {
    setBridge({ choose_file: vi.fn() });
    expect(isDesktopApp()).toBe(false);
  });

  it("sanitizeTitle 去掉非法字符并保留中文", () => {
    expect(sanitizeTitle("Transformer: 注意力/机制?")) .toBe("Transformer 注意力 机制");
    expect(sanitizeTitle("   ")) .toBe("rednote-note");
    expect(sanitizeTitle("结尾点...")) .toBe("结尾点");
    expect(sanitizeTitle("标".repeat(200)).length).toBe(80);
  });

  it("noteExportName 用标题命名（不再是 note-<id>.md）", () => {
    expect(noteExportName("注意力机制入门", 7)).toBe("注意力机制入门.md");
    expect(noteExportName("", 7)).toBe("note-7.md");
  });

  it("dateStamp 生成 YYYYMMDD", () => {
    expect(dateStamp(new Date(2026, 8, 9))).toBe("20260909");
  });

  it("describeSaveResult 覆盖成功/取消/失败三种结果", () => {
    expect(describeSaveResult({ ok: true, path: "H:\\a\\b.md" })).toBe("已保存到 H:\\a\\b.md");
    expect(describeSaveResult({ ok: false, cancelled: true })).toBe("已取消保存");
    expect(describeSaveResult({ ok: false, error: "磁盘已满" })).toBe("导出失败：磁盘已满");
  });

  it("浏览器环境 saveExportViaDesktop 返回 null 且不发请求", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    await expect(saveExportViaDesktop("/api/export/notes.md", "a.md")).resolves.toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("桌面环境：取内容转 base64 后交给桥", async () => {
    const save_file = vi.fn().mockResolvedValue({ ok: true, path: "H:\\out\\a.md" });
    setBridge({ save_file });
    // 直接用字节构造响应体，避免 jsdom Blob 与 fetch 实现不一致
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(new Uint8Array([104, 105]), { status: 200 })
    );

    const result = await saveExportViaDesktop("/api/notes/7/export.md", "注意力.md");

    expect(result).toEqual({ ok: true, path: "H:\\out\\a.md" });
    expect(save_file).toHaveBeenCalledTimes(1);
    const [name, b64] = save_file.mock.calls[0];
    expect(name).toBe("注意力.md");
    expect(atob(b64)).toBe("hi"); // 内容原样送达（base64 解码后为 hi）
  });

  it("桌面环境：导出接口失败时抛出可展示的错误", async () => {
    setBridge({ save_file: vi.fn() });
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("nope", { status: 500 }));

    await expect(saveExportViaDesktop("/api/export/notes.md", "a.md")).rejects.toThrow(
      "导出失败（500）"
    );
  });
});
