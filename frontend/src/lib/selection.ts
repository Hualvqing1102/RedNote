/** 阅读页选中文本的辅助：归一化选区文本 + 定位选区所在的段落序号。 */

/** 把选区文本压缩成单行便于展示/作为输入。 */
export function normalizedSelection(sel: Selection | null): string {
  if (!sel) return "";
  return sel.toString().replace(/\s+/g, " ").trim();
}

/** 找到某个 DOM 节点所在的正文块序号(data-row="b{index}")；找不到返回 -1。 */
export function rowIndexOf(container: HTMLElement, node: Node | null): number {
  if (!node) return -1;
  const el: Element | null =
    node.nodeType === Node.TEXT_NODE && node.parentElement
      ? node.parentElement
      : node instanceof Element
        ? node
        : null;
  if (!el || !container.contains(el)) return -1;
  const row = el.closest("[data-row]") as HTMLElement | null;
  const key = row?.dataset.row ?? "";
  return key.startsWith("b") ? Number(key.slice(1)) : -1;
}
