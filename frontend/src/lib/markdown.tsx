import type { ReactNode } from "react";

/**
 * 简易 Markdown 渲染（够 MVP 用）：
 * - 标题 # ~ ######（映射为 h3~h6，避免与页面主标题 h1/h2 冲突）
 * - 空行分段、无序列表（- / * / +）、有序列表（1. 1)）
 * - 行内：**加粗**、*斜体*、`行内代码`、[链接文字](url)（只保留文字）
 * - 引用 > 与分隔线 ---
 * 图片暂不渲染（需求：图片不要求保存）。
 */

type Inline = { kind: string; text: string };

const INLINE_RE = /(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*|_[^_]+_|\[[^\]]+\]\([^)]*\))/g;
function splitInline(text: string): Inline[] {
  return text
    .split(INLINE_RE)
    .filter(Boolean)
    .map((part) => {
      if (part.startsWith("`") && part.endsWith("`") && part.length >= 2) {
        return { kind: "code", text: part.slice(1, -1) };
      }
      if (part.startsWith("**") && part.endsWith("**") && part.length >= 4) {
        return { kind: "bold", text: part.slice(2, -2) };
      }
      if (part.startsWith("*") && part.endsWith("*") && part.length >= 2) {
        return { kind: "italic", text: part.slice(1, -1) };
      }
      if (part.startsWith("_") && part.endsWith("_") && part.length >= 2) {
        return { kind: "italic", text: part.slice(1, -1) };
      }
      const link = /^\[([^\]]+)\]\([^)]*\)$/.exec(part);
      if (link) {
        return { kind: "text", text: link[1] };
      }
      return { kind: "text", text: part };
    });
}

function renderInline(text: string, keyBase: string): ReactNode[] {
  return splitInline(text).map((it, i) => {
    const key = `${keyBase}-${i}`;
    switch (it.kind) {
      case "code":
        return <code key={key}>{it.text}</code>;
      case "bold":
        return <strong key={key}>{renderInline(it.text, key)}</strong>;
      case "italic":
        return <em key={key}>{renderInline(it.text, key)}</em>;
      default:
        return <span key={key}>{it.text.replace(/\s*\n\s*/g, " ")}</span>;
    }
  });
}

export type Block =
  | { kind: "heading"; level: number; text: string }
  | { kind: "ul"; items: string[] }
  | { kind: "ol"; items: string[] }
  | { kind: "quote"; lines: string[] }
  | { kind: "rule" }
  | { kind: "para"; text: string };

const HEADING_RE = /^(#{1,6})\s+(.*)$/;
const UL_ITEM_RE = /^\s*[-*+]\s+(.*)$/;
const OL_ITEM_RE = /^\s*\d+[.)]\s+(.*)$/;
const QUOTE_RE = /^\s*>\s?(.*)$/;

/** 按空行把整篇 Markdown 切成块，再逐块归类。 */
export function splitBlocks(text: string): Block[] {
  return text
    .split(/\n\s*\n/)
    .map((raw) => raw.trim())
    .filter(Boolean)
    .map((block): Block => {
      const lines = block.split("\n").map((l) => l.trim());
      const head = lines[0] ?? "";

      const heading = HEADING_RE.exec(head);
      if (heading) return { kind: "heading", level: heading[1].length, text: heading[2] };

      if (block === "---" || block === "***" || block === "___") return { kind: "rule" };

      const ulItems = lines
        .filter((l) => UL_ITEM_RE.test(l))
        .map((l) => UL_ITEM_RE.exec(l)![1]);
      if (ulItems.length && ulItems.length === lines.length) {
        return { kind: "ul", items: ulItems };
      }

      const olItems = lines
        .filter((l) => OL_ITEM_RE.test(l))
        .map((l) => OL_ITEM_RE.exec(l)![1]);
      if (olItems.length && olItems.length === lines.length) {
        return { kind: "ol", items: olItems };
      }

      const quoteLines = lines
        .filter((l) => QUOTE_RE.test(l))
        .map((l) => QUOTE_RE.exec(l)![1]);
      if (quoteLines.length && quoteLines.length === lines.length) {
        return { kind: "quote", lines: quoteLines };
      }

      return { kind: "para", text: lines.join("\n") };
    });
}

/** 渲染单个块级元素（供逐块内联插入注释时使用）。 */
export function renderOneBlock(block: Block, index: number): ReactNode {
  switch (block.kind) {
    case "heading": {
      const Tag = (["h3", "h4", "h5", "h6", "h6", "h6"] as const)[
        Math.min(block.level - 1, 5)
      ];
      return <Tag key={index}>{renderInline(block.text, `h${index}`)}</Tag>;
    }
    case "ul":
      return (
        <ul key={index}>
          {block.items.map((item, i) => (
            <li key={i}>{renderInline(item, `u${index}-${i}`)}</li>
          ))}
        </ul>
      );
    case "ol":
      return (
        <ol key={index}>
          {block.items.map((item, i) => (
            <li key={i}>{renderInline(item, `o${index}-${i}`)}</li>
          ))}
        </ol>
      );
    case "quote":
      return (
        <blockquote key={index}>
          {block.lines.map((line, i) => (
            <p key={i}>{renderInline(line, `q${index}-${i}`)}</p>
          ))}
        </blockquote>
      );
    case "rule":
      return <hr key={index} />;
    default:
      return <p key={index}>{renderInline(block.text, `p${index}`)}</p>;
  }
}

/** 把 Markdown 正文渲染成块级元素（标题/列表/段落等）。 */
export function renderBlocks(text: string): ReactNode[] {
  return splitBlocks(text).map(renderOneBlock);
}

/** 段落渲染：纯文本按空行分段（供原文摘录等非 Markdown 场景使用）。 */
export function renderParagraphs(text: string): ReactNode[] {
  return text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((paragraph, index) => <p key={index}>{renderInline(paragraph, `s${index}`)}</p>);
}

/** 去掉正文开头与标题完全相同的 Markdown 标题行，避免「笔记标题 + 正文标题」重复显示。 */
export function withoutLeadingTitle(markdown: string, title: string): string {
  const wanted = (title || "").trim();
  if (!wanted) return markdown;
  const lines = markdown.split("\n");
  let head = 0;
  while (head < lines.length && !lines[head].trim()) head += 1;
  if (head < lines.length) {
    const m = HEADING_RE.exec(lines[head].trim());
    if (m && m[2].trim() === wanted) {
      lines.splice(head, 1);
      // 顺带清掉其后的空行
      while (head < lines.length && !lines[head].trim()) lines.splice(head, 1);
    }
  }
  return lines.join("\n").trim();
}
