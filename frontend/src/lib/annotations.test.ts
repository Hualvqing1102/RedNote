import { describe, expect, it } from "vitest";
import { appendCommentAfter, relocateComment, resolveAnchor, rowsFor } from "./annotations";
import type { CommentCard } from "../types";

const card = (id: string, anchor?: number): CommentCard => ({ id, text: `文本${id}`, links: [], anchor });

describe("resolveAnchor / rowsFor", () => {
  it("缺省 anchor 放到最后一段之后", () => {
    expect(resolveAnchor(undefined, 3)).toBe(2);
    expect(resolveAnchor(-1, 3)).toBe(2);
    expect(resolveAnchor(9, 3)).toBe(2);
    expect(resolveAnchor(1, 3)).toBe(1);
  });

  it("按 块→注释 交错生成渲染行", () => {
    const rows = rowsFor(2, [card("A", 0), card("B", 0), card("C", 1)]);
    expect(rows.map((r) => r.key)).toEqual(["b0", "c:A", "c:B", "b1", "c:C"]);
  });
});

describe("relocateComment", () => {
  const three = [card("A", 0), card("B", 0), card("C", 1)];

  it("把注释移到前面块组内", () => {
    // 行序: b0,A,B,b1,C → 把 C 放到 A 之前(边界=行1) => anchor 0、组首
    const next = relocateComment(three, "C", 1, 2);
    const rows = rowsFor(2, next);
    expect(rows.map((r) => r.key)).toEqual(["b0", "c:C", "c:A", "c:B", "b1"]);
  });

  it("把注释从组内移到后面的块", () => {
    // A 移到 b1 之后、C 之前：边界指向行索引 4(C)
    const next = relocateComment(three, "A", 4, 2);
    const rows = rowsFor(2, next);
    expect(rows.map((r) => r.key)).toEqual(["b0", "c:B", "b1", "c:A", "c:C"]);
  });

  it("移到全文最末(边界=总行数)时追加到末段组尾", () => {
    const next = relocateComment(three, "A", rowsFor(2, three).length, 2);
    const rows = rowsFor(2, next);
    const tail = rows.slice(-3).map((r) => r.key);
    expect(tail).toEqual(["b1", "c:C", "c:A"]);
  });

  it("同一组内下移一位(A 放到 B 之后)", () => {
    const next = relocateComment(three, "A", 3, 2); // 边界=行3(b1 之前)
    const rowsA = rowsFor(2, next);
    expect(rowsA.map((r) => r.key)).toEqual(["b0", "c:B", "c:A", "b1", "c:C"]);
  });
});

describe("appendCommentAfter", () => {
  it("追加到指定块之后", () => {
    const next = appendCommentAfter([card("A", 0)], card("Z", 1), 1, 2);
    expect(rowsFor(2, next).map((r) => r.key)).toEqual(["b0", "c:A", "b1", "c:Z"]);
  });
});
