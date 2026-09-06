"""采集“补漏+去噪”测试：找回漏掉的段落/列表项，剔除订阅噪音。"""
from __future__ import annotations

from app.services.collect import _backfill_missing

HTML = """<!DOCTYPE html><html><head><meta charset="utf-8"><title>t</title></head>
<body><main>
<div class="newsletter-signup">
  <h2>Get the developer newsletter</h2>
  <p>Product updates, how-tos, community spotlights, and more. Delivered monthly to your inbox.</p>
</div>
<p>Context is a critical but finite resource for AI agents. In this post, we explore strategies for effectively curating and managing the context that powers them.</p>
<article>
  <p>After a few years of prompt engineering being the focus of attention in applied AI, a new term has come to prominence.</p>
  <p>We recommend organizing prompts into distinct sections and using techniques like XML tagging or Markdown headers to delineate these sections.</p>
  <h2>Context engineering for long-horizon tasks</h2>
  <p>Different approaches pay off in different settings:</p>
  <div class="feature-panel">
    <ul>
      <li>Compaction maintains conversational flow for tasks requiring extensive back-and-forth;</li>
      <li>Note-taking excels for iterative development with clear milestones;</li>
      <li>Multi-agent architectures handle complex research and analysis where parallel exploration pays dividends.</li>
    </ul>
  </div>
  <h2>Conclusion</h2>
  <p>Context engineering is still an evolving field, and there is much to learn about best practices.</p>
</article>
</main></body></html>"""

# 模拟 trafilatura 抽取结果：漏掉导语与 feature-panel 里的三条；订阅块被误抓进开头
MARKDOWN = (
    "## Get the developer newsletter\n\n"
    "Product updates, how-tos, community spotlights, and more. Delivered monthly to your inbox.\n\n"
    "After a few years of prompt engineering being the focus of attention in applied AI, "
    "a new term has come to prominence.\n\n"
    "We recommend organizing prompts into distinct sections and using techniques like "
    "XML tagging or Markdown headers to delineate these sections.\n\n"
    "## Context engineering for long-horizon tasks\n\n"
    "Different approaches pay off in different settings:"
)


def test_backfill_adds_missing_and_removes_noise():
    out = _backfill_missing(MARKDOWN, HTML)
    assert "Get the developer newsletter" not in out
    assert "Delivered monthly" not in out
    # 找回导语
    assert "critical but finite resource for AI agents" in out
    # 找回三条卡片列表项
    assert "Compaction maintains conversational flow" in out
    assert "Note-taking excels for iterative development" in out
    assert "Multi-agent architectures handle complex research" in out
    # 找回被丢弃的语义标题
    assert "## Conclusion" in out
    assert "still an evolving field" in out
    # 顺序：导语应在正文段之前，三条在“长时任务”小节内
    assert out.index("critical but finite resource") < out.index("After a few years")
    assert out.index("Compaction maintains") < out.index("Multi-agent architectures")
    assert out.index("## Conclusion") > out.index("Compaction maintains")


def test_backfill_unchanged_when_nothing_missing():
    md = "完全一致的段落。\n\n第二段。\n\n# 标题"
    html = "<main><p>完全一致的段落。</p><p>第二段。</p><h1>标题</h1></main>"
    assert _backfill_missing(md, html) == md
