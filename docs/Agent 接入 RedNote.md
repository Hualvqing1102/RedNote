# 其它 Agent 连接到 RedNote（接入指南）

> 目标：让 Claude Code / Codex / DSH 等 Agent 能把「讲解/总结 + 来源 + 笔记」读入或写入 RedNote。
> RedNote 暴露的是本机 REST API，**同一台主机**最稳；跨主机需要放开监听并注意安全（见 §4）。

## 1. RedNote 提供的能力（可直接调用的接口）

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | /api/notes?q=&deleted= | 搜索/列表笔记（FTS5 中文检索） |
| GET | /api/notes/{id} | 单篇笔记（标题/摘要/要点/正文/来源/附件列表） |
| GET | /api/folders | 收藏夹 |
| POST | /api/import/agent | **写入讲解/总结**为笔记：`{title, summary, points[], content, source_url, source_name, folder_id?}` |
| POST | /api/notes/{id}/files | 上传附件（multipart `file`） |
| GET/POST/PATCH/DELETE | /api/events… | 日历事件（日程/待办/每周重复） |
| GET | /api/export/notes.md、/api/export/backup.db | 导出/备份 |

服务地址：默认 `http://127.0.0.1:8000`（Run 桌面版时端口是随机的，可从 `%APPDATA%\RedNote\desktop.log` 看到实际端口；也可用 `REDNOTE_DESKTOP_PORT` 固定）。

## 2. 方式一：MCP 服务器（Claude Code / Codex 等）

`scripts/rednote_mcp.py` 是一个**无第三方依赖**（仅标准库）的 MCP 服务器，提供工具：
`search_notes` / `get_note` / `list_folders` / `import_note`（导入讲解为笔记）。

启动：`python scripts/rednote_mcp.py`（可设 `REDNOTE_API_URL` 指向 RedNote 地址）。

**Claude Code 配置**（`~/.claude.json` 或项目 `.mcp.json`）：
```json
{
  "mcpServers": {
    "rednote": {
      "command": "python",
      "args": ["H:/RedNote工程文件夹/scripts/rednote_mcp.py"],
      "env": { "REDNOTE_API_URL": "http://127.0.0.1:8000" }
    }
  }
}
```
Claude Desktop 同理写入 `claude_desktop_config.json` 的 `mcpServers`。

**Codex（OpenAI）**：若支持 MCP 则按同格式提供 `command/args/env`；不支持则用下面的 HTTP/CLI。

> 说明：该服务器实现 MCP 的 `tools/list` + `tools/call` 子集；首次集成时在 Agent 侧执行一次
> `tools/list` 即可看到四个工具。未实现的 MCP 能力（resource/prompt）会被忽略。

## 3. 方式二：DSH / 任何 Agent 直接调用（HTTP 或脚本）

**DSH（DeepSeek Harness）**：直接用现有导入脚本（写入桥，同机可用）：
```bash
python H:/RedNote工程文件夹/scripts/rednote_import.py \
  --title "讲解标题" --summary "摘要" --point "要点一" \
  --source-url "https://…" --content-file note.md --file paper.pdf
```

或直接 HTTP（任何会发请求的 Agent）：
```bash
curl -s -X POST http://127.0.0.1:8000/api/import/agent \
  -H "Content-Type: application/json" \
  -d '{"title":"T","content":"正文…","source_url":"https://…"}'
# 读笔记：
curl -s "http://127.0.0.1:8000/api/notes?q=上下文"
curl -s http://127.0.0.1:8000/api/notes/12
```

## 4. 跨主机 / 安全（重要）

- **默认只监听本机**：RedNote(桌面版)固定 `127.0.0.1`，别的主机访问不到。
- **要在另一台主机连**：用命令行起服务 `uvicorn app.server:app --host 0.0.0.0 --port 8000`
  （或把端口映射/SSH 隧道到本机），并把上面的 `REDNOTE_API_URL` 指向 `http://<主机IP>:8000`。
- **RedNote API 目前无鉴权**：一旦 `--host 0.0.0.0`，任何能访问该 IP:端口的人都可读写你的笔记。
  建议：只在可信内网/本机使用，或用 SSH 隧道、反向代理加 Basic Auth；不要直接暴露公网。
- 防火墙/沙箱：写 `%APPDATA%\RedNote` 或远程访问时，运行方需要有相应权限（远程场景请由目标机执行写入）。

## 5. 排障

- 连接失败：确认 RedNote 服务已启动；`curl http://127.0.0.1:8000/api/notes` 能返回即可。
- 桌面版端口：看 `%APPDATA%\RedNote\desktop.log`，或用 `REDNOTE_DESKTOP_PORT=8180` 固定端口后重新打包运行。
- MCP 报"无法连接 RedNote"：检查 `REDNOTE_API_URL` 是否指向实际服务地址。
