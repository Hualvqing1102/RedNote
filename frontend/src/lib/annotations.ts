import type { CommentCard } from "../types";

/**
 * 注释锚定（段落级）纯函数。
 *
 * 约定：注释卡片 {id, text, links, anchor} 中 anchor 表示「插在这一段之后」的
 * 段落序号（0 起）。正文先切成块（splitBlocks 的结果顺序），渲染时在每个块之后
 * 内联展示 anchor 等于该块序号的卡片，从而可插到原文任意段落。
 */

export type Row =
  | { type: "block"; key: string; index: number }
  | { type: "card"; key: string; anchor: number };

/** anchor 缺省/越界时解析为有效段落序号（缺省放末尾段之后）。 */
export function resolveAnchor(anchor: number | undefined, blocks: number): number {
  if (blocks <= 0) return -1;
  if (typeof anchor !== "number" || !Number.isFinite(anchor) || anchor < 0) {
    return blocks - 1;
  }
  return Math.min(Math.floor(anchor), blocks - 1);
}

/** 按「块 → 该块的注释卡」交错排成渲染行序列。 */
export function rowsFor(blocks: number, cards: CommentCard[]): Row[] {
  const rows: Row[] = [];
  for (let i = 0; i < blocks; i += 1) {
    rows.push({ type: "block", key: `b${i}`, index: i });
    for (const card of cards) {
      if (resolveAnchor(card.anchor, blocks) === i) {
        rows.push({ type: "card", key: `c:${card.id}`, anchor: i });
      }
    }
  }
  return rows;
}

export function rowKeys(blocks: number, cards: CommentCard[]): string[] {
  return rowsFor(blocks, cards).map((r) => r.key);
}

/**
 * 把某张注释卡片移动到「第 slot 个行边界之前」。
 * slot 取值范围 0..行数；slot=0(最顶部)会被修正为 1，避免注释出现在全文之前。
 * 返回新的 cards 数组（anchor 与组内顺序都已更新）。
 */
export function relocateComment(
  cards: CommentCard[],
  id: string,
  slot: number,
  blocks: number
): CommentCard[] {
  const rows = rowsFor(blocks, cards);
  const total = rows.length;
  const boundary = Math.max(1, Math.min(Math.round(slot), total));

  // 边界之前的最近一个块 → 新 anchor
  let anchor = 0;
  for (let i = 0; i < boundary; i += 1) {
    const r = rows[i];
    if (r.type === "block") anchor = r.index;
  }

  // 该 anchor 组里、边界之前的卡片数（含被拖卡片自身时也要算上）
  let posIncludingFrom = 0;
  let fromSeen = -1;
  for (let i = 0; i < boundary; i += 1) {
    const r = rows[i];
    if (r.type === "card" && r.anchor === anchor) {
      posIncludingFrom += 1;
      if (r.key === `c:${id}`) fromSeen = posIncludingFrom - 1;
    }
  }

  const from = cards.find((c) => c.id === id);
  if (!from) return cards;

  const rest = cards.filter((c) => c.id !== id);
  const group = rest.filter((c) => resolveAnchor(c.anchor, blocks) === anchor);
  const outside = rest.filter((c) => resolveAnchor(c.anchor, blocks) !== anchor);

  let insertAt = posIncludingFrom;
  if (fromSeen >= 0 && fromSeen < posIncludingFrom) {
    // 被拖动的卡片原本也在同一组且位于边界前，移除后序号前移一位
    insertAt -= 1;
  }
  const moved: CommentCard = { ...from, anchor };
  group.splice(Math.min(Math.max(insertAt, 0), group.length), 0, moved);
  return [...outside, ...group];
}

/** 在第 block 块之后追加一张新卡片。 */
export function appendCommentAfter(
  cards: CommentCard[],
  card: CommentCard,
  block: number,
  blocks: number
): CommentCard[] {
  const anchor = resolveAnchor(block, blocks);
  return [...cards, { ...card, anchor }];
}
