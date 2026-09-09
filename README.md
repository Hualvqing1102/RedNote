# RedNote 学习笔记（本地版）

一个本地优先的学习笔记应用：网页/PDF/DOCX/Markdown → 整理为可搜索、可批注、可规划的笔记。
桌面版 = 后端(Python) + 前端(React) 打包成的单机程序，不用装任何环境。

> 面向开发者/协作者的项目地图。**最终用户只需要 `dist\RedNote-日期.zip`。**

---

## 一、一眼看懂（它怎么分层）

```
你平时「写代码/看文档」的，都在这几块：
  app\            ← 后端（脑子：存数据、抓网页、调 AI、OCR…）
  frontend\src\   ← 前端（脸面：界面长什么样、点按钮做什么）
  tests\          ← 后端自动测试（防止改坏东西）
  docs\           ← 文档（方案、说明、开发记录）
  scripts\        ← 给"其它 AI/会话"用的辅助脚本
  run_desktop.py  ← 桌面版启动入口（打包时把它变成 RedNote.exe）

偶尔才用的：
  build_exe.ps1   ← 打包成 exe
  pack_release.ps1← 把 exe 压成给别人下载的 zip
  requirements*.txt ← 依赖清单（安装哪些库）
  AGENTS.md / .gitignore ← 给电脑/AI 看的"规则与忽略清单"

自动生成的、通常别手改（可删可重建）：
  .venv\  frontend\node_modules\  frontend\dist\
  build\  dist\RedNote\  data\

数据库本身在（不在工程里）：
  %APPDATA%\RedNote\   ← 你的全部笔记 + 设置 + 附件
```

---

## 二、分类明细

### A. 源码（开发时主要在这里改）
| 位置 | 干什么 | 什么时候碰 |
|---|---|---|
| `app/server.py` | 所有接口(URL)入口 | 加新功能/接口时 |
| `app/services/` | 各功能后端逻辑 | 采集/笔记/日历/AI/OCR 等逻辑 |
| `app/db.py` `settings.py` | 建数据库表、模型配置 | 加表/加模型时 |
| `frontend/src/views/` | 每个页面 | 改界面时 |
| `frontend/src/lib/` | 渲染器/工具 | 格式、链接等细节 |
| `frontend/src/api/client.ts` | 前端调用后端的统一入口 | 加接口调用时 |
| `run_desktop.py` | 桌面版启动+本地文件能力 | 打包相关 |

### B. 测试与质量（每次改完都要跑）
| 位置 | 干什么 |
|---|---|
| `tests/` | 后端自动化测试（pytest） |
| `frontend/src/**/*.test.*` | 前端自动化测试（vitest） |

### C. 文档（当说明书看/当记录写）
| 文件 | 内容 |
|---|---|
| `docs/技术方案.md` | 实现基线（当前架构/接口/数据表） |
| `docs/MVP方案.md` | 产品与设计 |
| `docs/桌面打包与维护指南.md` | 结构 + 维护 + 扩展 + 坑位 |
| `docs/Agent 接入 RedNote.md` | 让其它 AI 接入的方法 |
| `docs/开发记录.md` | 一步步开发过程（时间线） |
| `docs/Readme.txt` | 给最终用户的说明（会进分享包） |

### D. 构建与分发（偶尔用）
| 文件 | 干什么 |
|---|---|
| `build_exe.ps1` | 前端+后端打包成 `dist\RedNote\` |
| `pack_release.ps1` | 打成 zip 分享包 |

### E. 自动生成（别手动改，删了可重建）
`.venv\`、`frontend\node_modules\`、`frontend\dist\`、`build\`、`dist\RedNote\`、`data\`

---

## 三、新手最常用的命令

```powershell
# 1) 跑后端测试（确认没改坏）
.venv\Scripts\python.exe -m pytest -q

# 2) 跑前端测试
cd frontend
npm run test

# 3) 改完代码 → 重新打包 exe
powershell -ExecutionPolicy Bypass -File build_exe.ps1

# 4) 生成给别人下载的 zip
powershell -ExecutionPolicy Bypass -File pack_release.ps1 -SkipBuild
```

---

## 四、哪些千万别删
- `app\`、`frontend\src\`：源码；
- `run_desktop.py`、`build_exe.ps1`：打包要用的入口；
- `AGENTS.md`：给 AI/开发者的工作规则（改了会影响我之后的行为约定）。
