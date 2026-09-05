import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { renderBlocks, renderParagraphs, withoutLeadingTitle } from "./markdown";

function renderBlocksToDom(md: string): HTMLElement {
  const { container } = render(<div>{renderBlocks(md)}</div>);
  return container;
}

describe("renderBlocks", () => {
  it("把 #~###### 标题映射为 h3~h6(不与页面主标题冲突)", () => {
    const dom = renderBlocksToDom("# 一级\n\n## 二级\n\n### 三级\n\n#### 四级");
    expect(dom.querySelector("h3")?.textContent).toBe("一级");
    expect(dom.querySelector("h4")?.textContent).toBe("二级");
    expect(dom.querySelector("h5")?.textContent).toBe("三级");
    expect(dom.querySelector("h6")?.textContent).toBe("四级");
  });

  it("渲染无序与有序列表", () => {
    const dom = renderBlocksToDom("- 苹果\n- 香蕉\n\n1. 第一\n2. 第二");
    expect(dom.querySelectorAll("ul li")).toHaveLength(2);
    expect(dom.querySelector("ul li")?.textContent).toBe("苹果");
    expect(dom.querySelectorAll("ol li")).toHaveLength(2);
    expect(dom.querySelector("ol li:nth-child(2)")?.textContent).toBe("第二");
  });

  it("按空行分段渲染段落", () => {
    const dom = renderBlocksToDom("第一段。\n\n第二段。");
    expect(dom.querySelectorAll("p")).toHaveLength(2);
  });

  it("支持加粗/斜体/行内代码，并把链接渲染为可点击链接", () => {
    const dom = renderBlocksToDom("包含 **加粗** 与 *斜体* 与 `代码` 和 [链接文字](https://example.com/a)");
    expect(dom.querySelector("strong")?.textContent).toBe("加粗");
    expect(dom.querySelector("em")?.textContent).toBe("斜体");
    expect(dom.querySelector("code")?.textContent).toBe("代码");
    const link = dom.querySelector("a");
    expect(link?.textContent).toBe("链接文字");
    expect(link?.getAttribute("href")).toBe("https://example.com/a");
  });

  it("渲染行内/独立图片(含本地 /media 路径)", () => {
    const dom = renderBlocksToDom("图前文字 ![示意图](/media/abc123) 图后文字\n\n![独立图](/media/def456)");
    const imgs = dom.querySelectorAll("img");
    expect(imgs.length).toBe(2);
    expect(imgs[0].getAttribute("src")).toBe("/media/abc123");
    expect(imgs[0].getAttribute("alt")).toBe("示意图");
    expect(imgs[1].getAttribute("src")).toBe("/media/def456");
  });

  it("渲染 GFM 表格", () => {
    const dom = renderBlocksToDom("| 列1 | 列2 |\n|---|---|\n| 1a | 1b |\n| 2a | 2b |");
    const table = dom.querySelector("table");
    expect(table).not.toBeNull();
    expect(table?.querySelectorAll("thead th").length).toBe(2);
    expect(table?.querySelectorAll("tbody tr").length).toBe(2);
    expect(table?.querySelector("tbody tr td")?.textContent).toBe("1a");
  });

  it("渲染围栏代码块并保留缩进", () => {
    const dom = renderBlocksToDom("```python\ndef f():\n    return 42\n```");
    const pre = dom.querySelector("pre");
    expect(pre).not.toBeNull();
    expect(pre?.querySelector("code")?.textContent).toBe("def f():\n    return 42");
  });

  it("行内代码与正文区分显示", () => {
    const dom = renderBlocksToDom("调用 `run()` 完成");
    expect(dom.querySelector("code")?.textContent).toBe("run()");
  });

  it("缩进嵌套列表渲染为嵌套结构", () => {
    const dom = renderBlocksToDom("- 父项\n  - 子项一\n  - 子项二\n- 另一父项");
    const outerItems = dom.querySelector("ul")?.children;
    expect(outerItems?.length).toBe(2);
    // 第一项“父项”内应有嵌套 ul
    const firstLi = dom.querySelector("ul > li");
    expect(firstLi?.querySelector("ul > li")?.textContent).toBe("子项一");
    expect(dom.querySelectorAll("ul li").length).toBe(4);
  });

  it("渲染引用与分隔线", () => {
    const dom = renderBlocksToDom("> 一句引用\n\n正文\n\n---");
    expect(dom.querySelector("blockquote")?.textContent).toBe("一句引用");
    expect(dom.querySelector("hr")).not.toBeNull();
  });
});

describe("renderParagraphs", () => {
  it("纯文本按空行分段", () => {
    const { container } = render(<div>{renderParagraphs("第一段\n\n第二段")}</div>);
    expect(container.querySelectorAll("p")).toHaveLength(2);
  });
});

describe("withoutLeadingTitle", () => {
  it("移除与标题重复的首行标题", () => {
    expect(withoutLeadingTitle("# 我的文章\n\n正文第一段。", "我的文章")).toBe("正文第一段。");
  });

  it("标题不同时不移除", () => {
    const md = "# 原文标题\n\n正文。";
    expect(withoutLeadingTitle(md, "我的笔记")).toBe(md);
  });

  it("非标题开头不处理", () => {
    const md = "直接开始的正文。\n\n第二段。";
    expect(withoutLeadingTitle(md, "直接开始的正文")).toBe(md);
  });
});
