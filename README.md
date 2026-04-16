# ⚡ Workflow Console

> OpenClaw 工作流可视化控制台

**在线访问：** `https://console.folo-ai.com`

---

## 🎯 功能概览

Workflow Console 是对 OpenClaw 定时任务体系的可视化控制台，提供以下能力：

| 标签 | 功能 |
|------|------|
| 📋 定时任务 | 查看所有 cron 任务状态、手动触发、下次/上次执行时间 |
| 📂 内容存档 | 查看 content-archive 各分类下的 md 存档文件 |
| 🛠️ Skills | 浏览所有 Skills（工作台 56 + 全局 53） |
| 🎨 Image Gen | Gemini 图像生成（Nano Banana Pro 模型） |

---

## 📋 定时任务详情

每个任务均有以下属性：

| 任务 | 说明 | 云文档 | md 存档 |
|------|------|--------|---------|
| 🤖 AI Builders Digest | 每日 AI 行业资讯 8 维度摘要 | ✅ | ✅ `content-archive/ai-digest/YYYY-MM-DD.md` |
| 📋 每日经济政策资讯 | 10 大官媒政策整合 | ✅ | ✅ `content-archive/economic-policy/YYYY-MM-DD.md` |
| 🛠️ 每日热门Skill更新 | 热门 Skills 汇总 | ✅ | ✅ `content-archive/skill-updates/YYYY-MM-DD.md` |
| 📈 半导体设备股票行情 | A 股半导体设备板块播报 | ✅ | ❌ |
| 🌍 互联网出海开发专题集 | 出海开发 Top 5 文章 | ✅ | ✅ `content-archive/overseas-dev/YYYY-MM-DD.md` |
| 💭 Memory Dreaming Promotion | Memory 增强任务 | ✅ | ❌ |

**说明：**
- **云文档**：任务完成后通过 openclaw 内置 delivery 发送到飞书/微信
- **md 存档**：任务内容同步存档到 GitHub 仓库 [dynamicNing/content-archive](https://github.com/dynamicNing/content-archive)

---

## 🔌 API 接口

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/jobs` | 获取所有定时任务列表 |
| POST | `/api/jobs/:id/trigger` | 手动触发指定任务 |
| GET | `/api/jobs/:id/runs` | 获取任务最近 10 次运行历史 |
| GET | `/api/content` | 获取 content-archive 内容存档列表 |
| GET | `/api/skills` | 获取所有 Skills 列表 |
| POST | `/api/image/generate` | 生成图片（POST JSON: `{prompt, inputImage?}`） |
| GET | `/api/image/list` | 获取已生成图片列表 |

### 图像生成示例

```bash
# 生成图片
curl -X POST https://console.folo-ai.com/api/image/generate \
  -H "Content-Type: application/json" \
  -d '{"prompt":"一只橙色小猫"}'

# 响应
{"ok":true,"imageUrl":"/generated/1776346585761.png","timestamp":1776346585761}
```

### 触发任务示例

```bash
curl -X POST https://console.folo-ai.com/api/jobs/14e827f4-eb06-4c98-91b8-00928e638de3/trigger
```

---

## 🏗️ 技术架构

```
┌─────────────────────────────────────────────────────────────┐
│                        用户浏览器                            │
└─────────────────────┬───────────────────────────────────────┘
                      │ HTTPS (443)
                      ▼
┌─────────────────────────────────────────────────────────────┐
│                    Nginx (反向代理)                          │
│  console.folo-ai.com → 127.0.0.1:3099                       │
└─────────────────────┬───────────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────────┐
│              Express (Node.js) + Vue 3 CDN                   │
│                    端口 3099 / PM2 管理                      │
│  ┌──────────────┬──────────────┬──────────────┐             │
│  │  📋 Jobs API │ 📂 Content   │ 🛠️ Skills   │             │
│  │  🎨 Image API│              │              │             │
│  └──────────────┴──────────────┴──────────────┘             │
└─────────────────────┬───────────────────────────────────────┘
                      │
          ┌───────────┼────────────┐
          ▼           ▼            ▼
    ┌──────────┐ ┌──────────┐ ┌──────────────────┐
    │ openclaw │ │content-  │ │ Gemini API        │
    │ CLI      │ │archive/   │ │ (图像生成)        │
    │          │ │root/      │ │                   │
    └──────────┘ └──────────┘ └──────────────────┘
```

**技术栈：**
- 后端：Express 4.x（Node.js）
- 前端：Vue 3（CDN 单文件，无构建）
- 部署：PM2 + Nginx
- SSL：Let's Encrypt（Certbot 自动续期）

---

## 🚀 部署指南

### 环境要求

- Node.js ≥ 18
- PM2
- Nginx
- Certbot（SSL）

### 安装步骤

```bash
# 1. 克隆代码
git clone https://github.com/dynamicNing/workflow-console.git /www/workflow-console
cd /www/workflow-console

# 2. 安装依赖
npm install

# 3. 配置环境变量
pm2 set workflow-console:GEMINI_API_KEY "your-key"

# 4. 启动服务
pm2 start ecosystem.config.js
pm2 save

# 5. 配置 Nginx
sudo ln -sf /etc/nginx/sites-available/workflow-console /etc/nginx/sites-enabled/
sudo nginx -t && sudo nginx -s reload

# 6. 申请 SSL 证书（首次）
sudo certbot --nginx -d console.folo-ai.com
```

### Nginx 配置参考

```nginx
server {
    server_name console.folo-ai.com;

    location / {
        proxy_pass http://127.0.0.1:3099;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }

    listen 443 ssl;
    ssl_certificate /etc/letsencrypt/live/console.folo-ai.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/console.folo-ai.com/privkey.pem;
}
```

---

## 📡 Cron 任务 ID 映射

| 任务名称 | Cron ID |
|---------|---------|
| 🤖 AI Builders Digest | `14e827f4-eb06-4c98-91b8-00928e638de3` |
| 📋 每日经济政策资讯 | `52542803-71ee-4f7d-826d-4652b945ed85` |
| 🛠️ 每日热门Skill更新 | `865787cb-f15a-484b-a6ba-f1b88fd00fb0` |
| 📈 半导体设备股票行情 | `a0240533-ab2d-4da4-9079-0b1433014eae` |
| 🌍 互联网出海开发专题集 | `d92e41f3-88f2-4f51-8648-cdbfdec1a0a4` |
| 💭 Memory Dreaming Promotion | `923d63bf-3451-4525-a324-d7dfe72f1887` |

---

## 🔄 内容存档规范

所有 md 存档统一存放于 GitHub 仓库：[dynamicNing/content-archive](https://github.com/dynamicNing/content-archive)

```
content-archive/
├── ai-digest/          # AI Builders Digest 每日存档
├── economic-policy/    # 经济政策资讯存档
├── skill-updates/      # Skill 更新存档
├── overseas-dev/       # 出海开发专题存档
└── stock-market/       # 股票行情存档（预留）
```

命名格式：`YYYY-MM-DD.md`

---

## 🛠️ Skills 同步

当 workspace/skills 目录更新后，运行同步脚本自动同步到 GitHub：

```bash
bash ~/.openclaw/workspace/scripts/skills-sync.sh
```

该脚本会：
1. 扫描所有 Skills 生成 `public/skills.json`
2. 创建 Git 分支并提交
3. 推送到 GitHub 并创建 PR

---

## 📁 相关仓库

| 仓库 | 说明 |
|------|------|
| [dynamicNing/workflow-console](https://github.com/dynamicNing/workflow-console) | 控制台源码 |
| [dynamicNing/content-archive](https://github.com/dynamicNing/content-archive) | 内容存档仓库 |
| [dynamicNing/folo-ai](https://github.com/dynamicNing/folo-ai) | 主站源码 |
| [dynamicNing/workflow-console](https://github.com/dynamicNing/workflow-console) | Skills 同步目标 |
