import { describe, expect, it } from "vitest";
import { normalizedSelection, rowIndexOf } from "./selection";

describe("normalizedSelection", () => {
  it("把选区文本压缩成单行", () => {
    const sel = { toString: () => "  Attention  机制\n\n  是核心。  " } as unknown as Selection;
    expect(normalizedSelection(sel)).toBe("Attention 机制 是核心。");
  });

  it("空选区返回空串", () => {
    expect(normalizedSelection(null)).toBe("");
  });
});

describe("rowIndexOf", () => {
  function body(html: string): HTMLElement {
    const div = document.createElement("div");
    div.innerHTML = html;
    return div;
  }

  it("定位文本所在 data-row 序号", () => {
    const container = body(
      '<div><div data-row="b0"><p>第一段</p></div><div data-row="b1"><p>第二<span>重点</span></p></div></div>'
    );
    const span = container.querySelector("span");
    expect(rowIndexOf(container, span)).toBe(1);
    const firstP = container.querySelector("p");
    expect(rowIndexOf(container, firstP)).toBe(0);
  });

  it("非 data-row 或容器外返回 -1", () => {
    const container = body('<div data-row="b0"><p>正文</p></div>');
    const outside = body("<p>别处</p>");
    expect(rowIndexOf(container, outside)).toBe(-1);
    expect(rowIndexOf(container, null)).toBe(-1);
  });
});
