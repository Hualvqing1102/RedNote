import type { ReactNode } from "react";

/** 简易 Markdown 渲染：支持标题、段落、- 列表、**加粗**。够 M1 用。 */
export function renderBlocks(text: string): ReactNode[] {
  const blocks = text.split(/\n\s*\n/);
  return blocks.map((raw, index) => {
    const block = raw.trim();
    if (!block) return null;

    if (block.startsWith("# ")) {
      return <h3 key={index}>{renderInline(block.slice(2))}</h3>;
    }

    if (/^[-*] /.test(block)) {
      const items = block
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => /^[-*] /.test(line))
        .map((line) => line.replace(/^[-*] /, ""));
      return (
        <ul key={index}>
          {items.map((item, i) => (
            <li key={i}>{renderInline(item)}</li>
          ))}
        </ul>
      );
    }

    return <p key={index}>{renderInline(block)}</p>;
  });
}

/** 段落渲染：把换行拼成空格，避免段落内出现多余换行。 */
export function renderParagraphs(text: string): ReactNode[] {
  return text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((paragraph, index) => <p key={index}>{renderInline(paragraph)}</p>);
}

function renderInline(text: string): ReactNode[] {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, index) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return <strong key={index}>{part.slice(2, -2)}</strong>;
    }
    return <span key={index}>{part.replace(/\s*\n\s*/g, " ")}</span>;
  });
}
