# CLAUDE.md

本文件为 Claude Code (claude.ai/code) 在此仓库中工作提供指引。

## 启动服务

```bash
npm install          # 安装依赖
node server.js       # 本地启动，端口 3099
pm2 start ecosystem.config.js  # 生产环境启动（PM2）
pm2 restart workflow-console   # 生产环境重启
```

无构建步骤——前端使用 Vue 3 CDN，静态文件直接从 `public/` 目录提供服务。

## 架构说明

后端单文件：`server.js` 是完整的 Express 应用，没有独立的路由或控制器文件。

**前端：** `public/index.html` 是通过 CDN 加载的 Vue 3 SPA，所有 UI 逻辑都在这一个文件里。`public/login.html` 是独立的登录页。

**认证流程：** 基于 Cookie 的 Session（`console_session` cookie，有效期 7 天）。Session 存储在内存 `Map` 中。用户凭证从 `auth.json` 在启动时加载。非 API 路由未登录时重定向到 `/login.html`；API 路由返回 `401 { requireAuth: true }`。管理员路由检查 `session.role === 'admin'`。

**Hooks 系统：** Hook 定义保存在 `hooks.json`。执行历史持久化到 `/www/workflow-console/hook-runs/{hookId}.json`（最多保留 50 条）。Hook 异步执行 Shell 脚本——API 立即返回，不等待脚本完成。

**服务端运行时外部依赖：**
- `openclaw` CLI —— 用于查询/触发 cron 任务（`openclaw cron list --json`、`openclaw cron run <id>`、`openclaw cron runs --id <id>`）
- `/root/content-archive/` —— 内容存档 md 文件的文件系统路径
- `/root/.openclaw/cron/runs/*.jsonl` —— cron 运行日志（云文档 URL 的数据来源）
- `/root/.openclaw/workspace/skills/` —— workspace Skills 目录
- Gemini API 通过 Python 脚本调用：`/root/.openclaw/workspace/skills/gemini-image-simple/scripts/generate.py`

## 关键文件

| 文件 | 说明 |
|------|------|
| `server.js` | 完整后端（认证 + 所有 API 路由） |
| `public/index.html` | Vue 3 SPA（所有前端逻辑） |
| `public/login.html` | 登录页 |
| `public/skills.json` | Skills 静态列表（由 `skills-sync.sh` 同步生成） |
| `hooks.json` | Hook 定义（id、名称、脚本路径、超时时间） |
| `auth.json` | 用户凭证（启动时加载，覆盖默认值） |

## 生产部署

- 端口：`3099`（经 Nginx 反向代理，域名 `console.folo-ai.com`）
- 进程管理：PM2
- Gemini API Key 配置：`pm2 set workflow-console:GEMINI_API_KEY "your-key"`
- 生成的图片保存至 `public/generated/`（作为静态文件提供服务）
- Hook 执行日志保存至 `/www/workflow-console/hook-runs/`

## Design Context

### Users
自用运维工具，使用者是项目创建者本人。日常在 Mac/浏览器中打开，快速查看 OpenClaw 定时任务状态、触发任务、管理 Hooks 和浏览社交采集内容。使用频率较高，以读为主、偶尔触发操作。

### Brand Personality
**三个词：精准、克制、自主**
不是产品，是工具。像一个配置好的命令行 Dashboard——知道你要什么，安静地把信息呈现出来。

### Aesthetic Direction
- 深色系，保留现有方向
- 参考气质：Linear、Raycast、Vercel Dashboard——克制精准，有设计感但不表演
- 反参考：不要 glassmorphism、不要发光霓虹边框、不要 cyan/purple 渐变
- 字体：有个性的等宽或科技感字体，避免 Inter/Roboto
- 色彩：深色背景带轻微色调，1-2 个精准强调色

### Design Principles
1. 信息优先：每个像素都为信息服务
2. 操作清晰：主操作一眼可见，次要操作退后但可发现
3. 状态可信：运行状态、错误、成功视觉上可区分且准确
4. 克制的个性：有一两处记得住的细节，整体不喧宾夺主
5. 密度适中：不浪费屏幕，不难以扫读
