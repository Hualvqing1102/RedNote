# 学习笔记 Agent 软件 · MVP 产品方案

## 定位

本地优先的个人学习助手：粘贴网页链接 → 自动抓取内容 → Agent 生成结构化笔记 → 存到本地、可搜索、可追问。

## 技术选型

- 桌面框架：桌面应用（Python + FastAPI 后台，pywebview 桌面壳）；界面 React + TypeScript + Vite
- 前端：React + TypeScript
- 本地存储：SQLite（单文件、好备份）+ Markdown 正文
- Agent：统一 Provider 接口，默认 Claude API，可接本地部署模型（DeepSeek / Ollama 等，走 OpenAI 兼容端点）
- 网页解析：本地 Readability 抽取正文，不依赖第三方服务

## MVP 核心功能（Phase 1）

- 采集：粘贴 URL → 抓取标题、正文、来源，自动去掉广告和导航
- 总结：Agent 自动生成摘要 + 要点 + 建议标签
- 笔记：Markdown 编辑器，可编辑补充，一键保存到本地
- 管理：按主题 / 标签 / 来源分类，全文搜索历史笔记
- 追问：对已存的某条笔记或某个主题，向 Agent 提问并引用本地内容

## Phase 2（不在 MVP）

- 视频转写（ASR 语音转文字）
- 读取已有字幕的视频
- RAG 向量检索、截图 OCR、浏览器插件一键收藏

## 用户主流程

粘贴链接 → 抓取正文 → Agent 自动总结 → 编辑确认 → 存本地 → 搜索 / 追问

## 关键决策与风险

- 隐私提示：做总结和问答时，正文会发送到云端 API，UI 上要明确告知用户
- API Key：只存本地，不上传
- 防锁定：支持导出 Markdown 和 SQLite 备份，数据始终归用户

## 粗略里程碑

- M1：网页采集 + 本地存储 + 笔记编辑
- M2：Agent 总结 + 问答
- M3：搜索 / 标签 + 体验打磨
