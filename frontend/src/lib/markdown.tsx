import type { ReactNode } from "react";

/**
 * Markdown 渲染器(MVP+)：
 * - 标题 #~######（映射为 h3~h6，避免与页面主标题 h1/h2 冲突）
 * - 空行分段、无序/有序列表（支持缩进嵌套）、引用 >、分隔线 ---
 * - GFM 表格（| 分隔）
 * - 行内：**加粗**、*斜体*、`行内代码`、[链接](url)、![图片](src)
 * 图片引用 /media/{token}(本地抓取)或 http(s) 链接，均不保存图片数据于前端。
 */

type Inline =
  | { kind: "text"; text: string }
  | { kind: "bold"; text: string }
  | { kind: "italic"; text: string }
  | { kind: "code"; text: string }
  | { kind: "link"; text: string; src: string }
  | { kind: "image"; text: string; src: string };

const INLINE_TOKEN_RE =
  /(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*|_[^_]+_|!\[[^\]]*\]\([^)\s]+\)|\[[^\]]+\]\([^)\s]+\))/g;

function splitInline(text: string): Inline[] {
  return text
    .split(INLINE_TOKEN_RE)
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
      const image = /^!\[([^\]]*)\]\(([^)\s]+)\)$/.exec(part);
      if (image) {
        return { kind: "image", text: image[1], src: image[2] };
      }
      const link = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(part);
      if (link) {
        return { kind: "link", text: link[1], src: link[2] };
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
      case "image":
        return (
          <img
            key={key}
            className="md-img-inline"
            src={it.src}
            alt={it.text}
            loading="lazy"
            referrerPolicy="no-referrer"
          />
        );
      case "link":
        return (
          <a key={key} href={it.src} target="_blank" rel="noreferrer">
            {it.text}
          </a>
        );
      default:
        return <span key={key}>{it.text.replace(/\s*\n\s*/g, " ")}</span>;
    }
  });
}

export type Block =
  | { kind: "heading"; level: number; text: string }
  | { kind: "ul"; items: string[]; depths?: number[] }
  | { kind: "ol"; items: string[]; depths?: number[] }
  | { kind: "quote"; lines: string[] }
  | { kind: "table"; headers: string[]; rows: string[][] }
  | { kind: "code"; text: string }
  | { kind: "rule" }
  | { kind: "para"; text: string };

const HEADING_RE = /^(#{1,6})\s+(.*)$/;
const LIST_ITEM_RE = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;
const QUOTE_RE = /^\s*>\s?(.*)$/;
const TABLE_SEP_RE = /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/;

function listDepths(lines: string[], kind: "ul" | "ol"): { items: string[]; depths: number[] } {
  const items: string[] = [];
  const depths: number[] = [];
  for (const line of lines) {
    const m = LIST_ITEM_RE.exec(line);
    if (!m) continue;
    const marker = m[2];
    const isOrdered = /^\d/.test(marker);
    if ((kind === "ul" && isOrdered) || (kind === "ol" && !isOrdered)) continue;
    items.push(m[3]);
    depths.push(Math.floor(m[1].replace(/\t/g, "  ").length / 2));
  }
  return { items, depths };
}

function splitCells(line: string): string[] {
  return line
    .trim()
    .replace(/^\||\|$/g, "")
    .split("|")
    .map((c) => c.trim());
}

/** 按空行把整篇 Markdown 切成块，再逐块归类。 */
export function splitBlocks(text: string): Block[] {
  return text
    .split(/\n\s*\n/)
    .map((raw) => raw.trim())
    .filter(Boolean)
    .map((block): Block => {
      const lines = block.split("\n").map((l) => l.trimEnd());
      const head = lines[0] ?? "";

      const heading = HEADING_RE.exec(head);
      if (heading) return { kind: "heading", level: heading[1].length, text: heading[2] };

      if (block === "---" || block === "***" || block === "___") return { kind: "rule" };

      // 围栏代码块 ```lang … ```
      if (block.startsWith("```")) {
        const codeLines = block.split("\n");
        codeLines.shift();
        if (codeLines.length && codeLines[codeLines.length - 1].trim().startsWith("```")) {
          codeLines.pop();
        }
        return { kind: "code", text: codeLines.join("\n") };
      }

      // GFM 表格：首行表头 + 第二行分隔线
      if (lines.length >= 2 && TABLE_SEP_RE.test(lines[1])) {
        const headers = splitCells(lines[0]);
        const rows = lines.slice(2).map(splitCells);
        return { kind: "table", headers, rows };
      }

      // 兜底：无分隔行的管道表格（如微信公众号常见写法），每行都以 | 起止
      if (lines.length >= 2 && lines.every((l) => /^\|.*\|\s*$/.test(l))) {
        const headers = splitCells(lines[0]);
        const rows = lines.slice(1).map(splitCells);
        return { kind: "table", headers, rows };
      }

      const ul = listDepths(lines, "ul");
      if (ul.items.length && ul.items.length === lines.length) {
        return { kind: "ul", items: ul.items, depths: ul.depths };
      }
      const ol = listDepths(lines, "ol");
      if (ol.items.length && ol.items.length === lines.length) {
        return { kind: "ol", items: ol.items, depths: ol.depths };
      }

      const quoteLines = lines
        .map((l) => QUOTE_RE.exec(l)?.[1])
        .filter((v): v is string => v !== undefined);
      if (quoteLines.length && quoteLines.length === lines.length) {
        return { kind: "quote", lines: quoteLines };
      }

      return { kind: "para", text: lines.join("\n") };
    });
}

type ListItem = { text: string; children: ListItem[] };

function buildTree(items: string[], depths: number[]): ListItem[] {
  const root: ListItem[] = [];
  const stack: { node: ListItem; depth: number }[] = [];
  for (let i = 0; i < items.length; i += 1) {
    const depth = depths[i] ?? 0;
    const node: ListItem = { text: items[i], children: [] };
    while (stack.length && stack[stack.length - 1].depth >= depth) stack.pop();
    if (stack.length) stack[stack.length - 1].node.children.push(node);
    else root.push(node);
    stack.push({ node, depth });
  }
  return root;
}

function renderList(nodes: ListItem[], keyBase: string, ordered: boolean): ReactNode {
  const Tag = ordered ? "ol" : "ul";
  return (
    <Tag key={keyBase}>
      {nodes.map((item, i) => (
        <li key={`${keyBase}-${i}`}>
          {renderInline(item.text, `${keyBase}-t${i}`)}
          {item.children.length > 0 && renderList(item.children, `${keyBase}-c${i}`, false)}
        </li>
      ))}
    </Tag>
  );
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
      return renderList(buildTree(block.items, block.depths ?? []), `ul${index}`, false);
    case "ol":
      return renderList(buildTree(block.items, block.depths ?? []), `ol${index}`, true);
    case "table": {
      const cols = block.headers.length;
      return (
        <div className="md-table-wrap" key={index}>
          <table>
            <thead>
              <tr>
                {block.headers.map((h, i) => (
                  <th key={i}>{renderInline(h, `th${index}-${i}`)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, ri) => (
                <tr key={ri}>
                  {Array.from({ length: cols }, (_, ci) => (
                    <td key={ci}>{renderInline(row[ci] ?? "", `td${index}-${ri}-${ci}`)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    }
    case "quote":
      return (
        <blockquote key={index}>
          {block.lines.map((line, i) => (
            <p key={i}>{renderInline(line, `q${index}-${i}`)}</p>
          ))}
        </blockquote>
      );
    case "code":
      return (
        <pre className="md-pre" key={index}>
          <code>{block.text}</code>
        </pre>
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
