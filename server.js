const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const { execSync, exec } = require('child_process');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3099;

app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors());
app.use(express.json());
// ============================================================
// 认证系统（Cookie Session）
// ============================================================

const AUTH_FILE = path.join(__dirname, 'auth.json');
const COOKIE_NAME = 'console_session';
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7天

let authConfig = {
  users: [
    { username: 'admin', password: 'Nomi2026Console', role: 'admin', label: '管理员' },
    { username: 'guest', password: 'guest', role: 'guest', label: '游客' }
  ],
  sessionSecret: 'default-secret'
};
try {
  const loaded = JSON.parse(fs.readFileSync(AUTH_FILE, 'utf-8'));
  if (loaded.users) authConfig = loaded;
  else if (loaded.username) {
    // 兼容旧格式
    authConfig.users = [{
      username: loaded.username,
      password: loaded.password,
      role: 'admin',
      label: '管理员'
    }];
  }
} catch {}

// session store: token -> { createdAt }
const sessions = new Map();

function generateToken() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let token = '';
  for (let i = 0; i < 32; i++) token += chars[Math.floor(Math.random() * chars.length)];
  return token;
}

function parseCookies(header) {
  const cookies = {};
  if (!header) return cookies;
  header.split(';').forEach(c => {
    const [k, ...v] = c.trim().split('=');
    if (k) cookies[k] = decodeURIComponent(v.join('='));
  });
  return cookies;
}

// 登录
app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body || {};
  const user = authConfig.users.find(u => u.username === username && u.password === password);
  if (user) {
    const token = generateToken();
    sessions.set(token, { createdAt: Date.now(), role: user.role, username: user.username, label: user.label });
    res.cookie(COOKIE_NAME, token, {
      httpOnly: true,
      maxAge: SESSION_TTL_MS,
      sameSite: 'lax',
      secure: req.headers['x-forwarded-proto'] === 'https' || req.protocol === 'https'
    });
    res.json({ ok: true, message: '登录成功' });
  } else {
    res.json({ ok: false, error: '用户名或密码错误' });
  }
});

// 登出
app.post('/api/auth/logout', (req, res) => {
  const cookies = parseCookies(req.headers.cookie);
  const token = cookies[COOKIE_NAME];
  if (token) sessions.delete(token);
  res.clearCookie(COOKIE_NAME);
  res.json({ ok: true });
});

// 登录状态
app.get('/api/auth/status', (req, res) => {
  const cookies = parseCookies(req.headers.cookie);
  const token = cookies[COOKIE_NAME];
  if (token && sessions.has(token)) {
    const session = sessions.get(token);
    if (Date.now() - session.createdAt < SESSION_TTL_MS) {
      return res.json({ ok: true, loggedIn: true, role: session.role, username: session.username, label: session.label });
    }
    sessions.delete(token);
  }
  res.json({ ok: true, loggedIn: false, role: null });
});

// 登录页（未登录时重定向到这里）
app.get('/login.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

// SPA 前端路由保护：未登录时重定向到登录页（必须在 static 之前）
app.use((req, res, next) => {
  if (req.path === '/login.html' || req.path.startsWith('/api/') || req.path.startsWith('/generated/')) return next();
  const cookies = parseCookies(req.headers.cookie);
  const token = cookies[COOKIE_NAME];
  if (!token || !sessions.has(token) || Date.now() - sessions.get(token).createdAt >= SESSION_TTL_MS) {
    if (token) sessions.delete(token);
    return res.redirect('/login.html');
  }
  next();
});

app.use(express.static(path.join(__dirname, 'public')));
app.use('/api', (req, res, next) => {
  // 排除登录本身和 ljg-chat 接口
  if (req.path === '/auth/login' || req.path === '/auth/logout' || req.path === '/auth/status' || req.path === '/ljg/chat') {
    return next();
  }
  const cookies = parseCookies(req.headers.cookie);
  const token = cookies[COOKIE_NAME];
  if (!token || !sessions.has(token) || Date.now() - sessions.get(token).createdAt >= SESSION_TTL_MS) {
    if (token) sessions.delete(token);
    return res.status(401).json({ ok: false, error: '请先登录', requireAuth: true });
  }
  next();
});

// ============================================================
// 任务名称映射（短名）

// 任务名称映射（短名）
const JOB_NAMES = {
  '14e827f4-eb06-4c98-91b8-00928e638de3': '🤖 AI Builders Digest',
  '52542803-71ee-4f7d-826d-4652b945ed85': '📋 每日经济政策资讯',
  '865787cb-f15a-484b-a6ba-f1b88fd00fb0': '🛠️ 每日热门Skill更新',
  'a0240533-ab2d-4da4-9079-0b1433014eae': '📈 半导体设备股票行情',
  'd92e41f3-88f2-4f51-8648-cdbfdec1a0a4': '🌍 互联网出海开发专题集',
  '923d63bf-3451-4525-a324-d7dfe72f1887': '💭 Memory Dreaming Promotion'
};

// 任务详情：云文档、存档路径
// 
// 【存档规则】
// 1. 主目录 content-archive/ 不存放任何 md 文件，统一在子目录分类
// 2. 仅以下 3 个 cron 任务允许生成 md 存档到 content-archive：
//    - 14e827f4 (AI Builders Digest)        → ai-digest/
//    - 52542803 (每日经济政策资讯)          → economic-policy/
//    - d92e41f3 (互联网出海开发专题集)      → overseas-dev/
// 3. 其他任务（skill-updates / stock-market / memory）不生成 md 存档
//
const JOB_DETAILS = {
  '14e827f4-eb06-4c98-91b8-00928e638de3': {
    cloudDoc: true,
    cloudDocUrl: 'openclaw 内置发送',
    mdArchive: true,
    mdArchivePath: 'content-archive/ai-digest/YYYY-MM-DD.md',
    description: '每日 AI 行业资讯摘要，覆盖 Newsletter/社区/产品/融资/研究/监管/开源/中文圈 8 维度'
  },
  '52542803-71ee-4f7d-826d-4652b945ed85': {
    cloudDoc: true,
    cloudDocUrl: 'openclaw 内置发送',
    mdArchive: true,
    mdArchivePath: 'content-archive/economic-policy/YYYY-MM-DD.md',
    description: '每日经济政策资讯，整合 10 大官媒来源（新华社/人民日报/央视等）'
  },
  '865787cb-f15a-484b-a6ba-f1b88fd00fb0': {
    cloudDoc: true,
    cloudDocUrl: 'openclaw 内置发送',
    mdArchive: false,
    mdArchivePath: null,
    description: '每日热门 Skill 更新汇总（结果仅发送飞书，不存档）'
  },
  'a0240533-ab2d-4da4-9079-0b1433014eae': {
    cloudDoc: true,
    cloudDocUrl: 'openclaw 内置发送',
    mdArchive: false,
    mdArchivePath: null,
    description: 'A股半导体设备板块行情播报（北方华创/中微/拓荆/长川等 + ETF159516）'
  },
  'd92e41f3-88f2-4f51-8648-cdbfdec1a0a4': {
    cloudDoc: true,
    cloudDocUrl: 'openclaw 内置发送',
    mdArchive: true,
    mdArchivePath: 'content-archive/overseas-dev/YYYY-MM-DD.md',
    description: '互联网出海开发专题集，Top 5 文章精选'
  },
  '923d63bf-3451-4525-a324-d7dfe72f1887': {
    cloudDoc: true,
    cloudDocUrl: 'openclaw 内置发送',
    mdArchive: false,
    mdArchivePath: null,
    description: 'Memory Dreaming 增强任务（结果仅发送飞书，不存档）'
  }
};

// 内容存档映射
const CONTENT_MAP = {
  '🤖 AI Builders Digest': { dir: 'ai-digest', repo: 'content-archive' },
  '📋 每日经济政策资讯': { dir: 'economic-policy', repo: 'content-archive' },
  '🛠️ 每日热门Skill更新': { dir: 'skill-updates', repo: 'content-archive' },
  '🌍 互联网出海开发专题集': { dir: 'overseas-dev', repo: 'content-archive' },
  '📈 半导体设备股票行情': { dir: 'stock-market', repo: 'content-archive' },
};

// 格式化时间
function formatTime(ms) {
  if (!ms) return '-';
  const d = new Date(ms);
  const now = new Date();
  const diff = now - d;
  if (diff < 60000) return '刚刚';
  if (diff < 3600000) return `${Math.floor(diff/60000)}分钟前`;
  if (diff < 86400000) return `${Math.floor(diff/3600000)}小时前`;
  return d.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
}

// API: 获取所有任务列表
app.get('/api/jobs', (req, res) => {
  try {
    const output = execSync('openclaw cron list --json', { encoding: 'utf-8' });
    const data = JSON.parse(output);
    const jobs = data.jobs.map(job => ({
      id: job.id,
      name: JOB_NAMES[job.id] || job.name,
      schedule: job.schedule.expr,
      enabled: job.enabled,
      nextRun: formatTime(job.state?.nextRunAtMs),
      nextRunMs: job.state?.nextRunAtMs,
      lastRun: formatTime(job.state?.lastRunAtMs),
      lastRunMs: job.state?.lastRunAtMs,
      lastStatus: job.state?.lastRunStatus || '-',
      status: job.state?.lastStatus || 'unknown',
      delivery: job.delivery?.mode || '-',
      channel: job.delivery?.channel || '-',
      ...(JOB_DETAILS[job.id] || {})
    }));
    res.json({ ok: true, jobs });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});

// API: 触发任务
app.post('/api/jobs/:id/trigger', (req, res) => {
  const { id } = req.params;
  try {
    execSync(`openclaw cron run ${id}`, { encoding: 'utf-8' });
    res.json({ ok: true, message: '任务已触发' });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});

// API: 获取任务运行历史
app.get('/api/jobs/:id/runs', (req, res) => {
  const { id } = req.params;
  try {
    const output = execSync(`openclaw cron runs --id ${id} --limit 10`, { encoding: 'utf-8' });
    const lines = output.trim().split('\n').filter(l => l.startsWith('{'));
    const runs = lines.map(line => {
      try {
        const r = JSON.parse(line);
        return {
          runId: r.runId,
          triggeredAt: formatTime(r.triggeredAtMs),
          triggeredAtMs: r.triggeredAtMs,
          finishedAt: formatTime(r.finishedAtMs),
          durationMs: r.durationMs,
          status: r.status,
          error: r.error || null
        };
      } catch { return null; }
    }).filter(Boolean);
    res.json({ ok: true, runs });
  } catch (e) {
    res.json({ ok: false, error: e.message, runs: [] });
  }
});

// API: 获取内容存档列表
app.get('/api/content', (req, res) => {
  try {
    const contentDir = '/root/content-archive';
    if (!fs.existsSync(contentDir)) {
      return res.json({ ok: true, content: [] });
    }
    const items = [];
    const dirs = fs.readdirSync(contentDir);
    for (const dir of dirs) {
      const dirPath = path.join(contentDir, dir);
      if (!fs.statSync(dirPath).isDirectory() || dir === '.git') continue;
      const files = fs.readdirSync(dirPath).filter(f => f.endsWith('.md')).sort().reverse();
      items.push({
        category: dir,
        files: files.map(f => ({
          name: f,
          path: `/${dir}/${f}`,
          date: f.replace('.md', '')
        }))
      });
    }
    res.json({ ok: true, content: items });
  } catch (e) {
    res.json({ ok: false, error: e.message, content: [] });
  }
});

// API: 获取云文档记录（从 cron run JSONL 中提取飞书文档链接）
// OpenClaw 在每次 run 后覆盖 summary，故仅能获取各 job 最新的文档链接
const CLOUD_DOC_JOBS = {
  '14e827f4-eb06-4c98-91b8-00928e638de3': { name: '🤖 AI Builders Digest', category: 'ai-digest' },
  '52542803-71ee-4f7d-826d-4652b945ed85': { name: '📋 每日经济政策资讯', category: 'economic-policy' },
  'd92e41f3-88f2-4f51-8648-cdbfdec1a0a4': { name: '🌍 互联网出海开发专题集', category: 'overseas-dev' }
};

app.get('/api/cloud-docs', (req, res) => {
  try {
    const runsDir = '/root/.openclaw/cron/runs';
    const docPattern = /https:\/\/feishu\.cn\/docx\/([a-zA-Z0-9]+)/g;
    const seenUrls = new Set();
    const results = [];

    if (!fs.existsSync(runsDir)) return res.json({ ok: true, docs: [] });

    // 扫描所有 cron runs JSONL 文件
    const files = fs.readdirSync(runsDir).filter(f => f.endsWith('.jsonl'));
    for (const fname of files) {
      const jobId = fname.replace('.jsonl', '');
      const jobInfo = CLOUD_DOC_JOBS[jobId] || null;
      const runFile = path.join(runsDir, fname);
      const content = fs.readFileSync(runFile, 'utf-8');
      const lines = content.trim().split('\n').filter(l => l.startsWith('{'));

      for (const line of lines) {
        try {
          const run = JSON.parse(line);
          if (run.status !== 'ok') continue;
          const summary = run.summary || '';
          const urls = [...summary.matchAll(docPattern)];
          if (!urls.length) continue;
          const url = 'https://feishu.cn/docx/' + urls[0][1];
          if (seenUrls.has(url)) continue;
          seenUrls.add(url);
          const ts = run.ts || 0;
          const d = new Date(ts);
          results.push({
            jobId,
            jobName: jobInfo ? jobInfo.name : jobId.slice(0, 8),
            category: jobInfo ? jobInfo.category : 'other',
            docUrl: url,
            date: d.toISOString().slice(0, 10),
            datetime: d.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }),
            ts
          });
        } catch { continue; }
      }
    }

    results.sort((a, b) => b.ts - a.ts);

    // 按 job 分组，每组取最新一条
    const grouped = {};
    for (const r of results) {
      if (!grouped[r.jobId] || r.ts > grouped[r.jobId].ts) {
        grouped[r.jobId] = r;
      }
    }
    const docs = Object.values(grouped).sort((a, b) => b.ts - a.ts);
    res.json({ ok: true, docs, total: docs.length });
  } catch (e) {
    res.json({ ok: false, error: e.message, docs: [], total: 0 });
  }
});

// API: 获取所有 Skills
app.get('/api/skills', (req, res) => {
  try {
    const skillsDir = '/root/.openclaw/workspace/skills';
    const globalDir = '/root/.local/share/pnpm/global/5/.pnpm/openclaw@2026.4.12_@emnapi+core@1.9.2_@emnapi+runtime@1.9.2_@napi-rs+canvas@0.1.97_@typ_0cce31112b9f587783dcad3a63b36617/node_modules/openclaw/skills';
    
    function parseFrontmatter(content) {
      const match = content.match(/^---\n([\s\S]*?)\n---/);
      if (!match) return { name: '', description: '', emoji: '' };
      const fm = {};
      match[1].split('\n').forEach(line => {
        const [key, ...rest] = line.split(':');
        if (key && rest.length) fm[key.trim()] = rest.join(':').trim();
      });
      return fm;
    }
    
    function readSkills(dir) {
      if (!fs.existsSync(dir)) return [];
      return fs.readdirSync(dir).filter(s => !s.startsWith('.')).map(name => {
        const skillPath = path.join(dir, name);
        if (!fs.statSync(skillPath).isDirectory()) return null;
        const metaPath = path.join(skillPath, '_meta.json');
        const skillMdPath = path.join(skillPath, 'SKILL.md');
        let meta = {};
        let description = '';
        let emoji = '';
        try {
          if (fs.existsSync(metaPath)) meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
          if (fs.existsSync(skillMdPath)) {
            const content = fs.readFileSync(skillMdPath, 'utf-8');
            const fm = parseFrontmatter(content);
            description = fm.description || '';
            const md = JSON.parse(meta.metadata || '{}');
            emoji = md.clawdbot?.emoji || '';
          }
        } catch {}
        return {
          name: meta.slug || name,
          slug: meta.slug || name,
          version: meta.version || '-',
          publishedAt: meta.publishedAt ? new Date(meta.publishedAt).toLocaleDateString('zh-CN') : '-',
          description,
          emoji,
          category: dir.includes('workspace') ? 'workspace' : 'global',
          path: skillPath
        };
      }).filter(Boolean);
    }
    
    const workspaceSkills = readSkills(skillsDir);
    const globalSkills = readSkills(globalDir);
    res.json({ ok: true, skills: workspaceSkills, total: workspaceSkills.length + globalSkills.length });
  } catch (e) {
    res.json({ ok: false, error: e.message, skills: [], total: 0 });
  }
});

// API: 生成图片
app.post('/api/image/generate', async (req, res) => {
  const { prompt, inputImage } = req.body;
  if (!prompt) return res.json({ ok: false, error: 'prompt 不能为空' });

  const timestamp = Date.now();
  const outputFile = `/www/workflow-console/public/generated/${timestamp}.png`;
  const logFile = `/tmp/gemini_gen_${timestamp}.log`;
  const generatedDir = '/www/workflow-console/public/generated';
  if (!fs.existsSync(generatedDir)) fs.mkdirSync(generatedDir, { recursive: true });

  try {
    // 如果有输入图片，先保存
    if (inputImage) {
      const inputFile = `/tmp/gemini_input_${timestamp}.png`;
      const imgData = inputImage.startsWith('data:') ? inputImage.split(',')[1] : inputImage;
      fs.writeFileSync(inputFile, Buffer.from(imgData, 'base64'));
      // 调用 python 生成（编辑模式）
      const { execSync } = require('child_process');
      const out = execSync(`python3 /root/.openclaw/workspace/skills/gemini-image-simple/scripts/generate.py "${prompt.replace(/"/g, '\\"')}" "${outputFile}" --input "${inputFile}" > "${logFile}" 2>&1; echo "exit:$?"`, { encoding: 'utf-8', timeout: 120000 });
      const exitOk = out.includes('exit:0');
      if (!exitOk) {
        const log = fs.readFileSync(logFile, 'utf-8').slice(-500);
        return res.json({ ok: false, error: '生成失败: ' + log });
      }
    } else {
      // 调用 python 生成（新图模式）
      const { execSync } = require('child_process');
      const out = execSync(`python3 /root/.openclaw/workspace/skills/gemini-image-simple/scripts/generate.py "${prompt.replace(/"/g, '\\"')}" "${outputFile}" > "${logFile}" 2>&1; echo "exit:$?"`, { encoding: 'utf-8', timeout: 120000 });
      const exitOk = out.includes('exit:0');
      if (!exitOk) {
        const log = fs.readFileSync(logFile, 'utf-8').slice(-500);
        return res.json({ ok: false, error: '生成失败: ' + log });
      }
    }

    // 读取生成的图片并转为 base64
    const imgBase64 = fs.readFileSync(outputFile).toString('base64');
    const imageUrl = `/generated/${timestamp}.png?t=${timestamp}`;
    res.json({ ok: true, imageUrl, timestamp });
  } catch (e) {
    const log = fs.existsSync(logFile) ? fs.readFileSync(logFile, 'utf-8').slice(-500) : e.message;
    res.json({ ok: false, error: '生成失败: ' + log });
  }
});

// API: 获取已生成的图片列表
app.get('/api/image/list', (req, res) => {
  try {
    const generatedDir = '/www/workflow-console/public/generated';
    if (!fs.existsSync(generatedDir)) return res.json({ ok: true, images: [] });
    const files = fs.readdirSync(generatedDir)
      .filter(f => f.endsWith('.png'))
      .sort()
      .reverse()
      .slice(0, 20)
      .map(f => ({
        name: f,
        url: `/generated/${f}`,
        timestamp: parseInt(f.replace('.png', ''))
      }));
    res.json({ ok: true, images: files });
  } catch (e) {
    res.json({ ok: false, error: e.message, images: [] });
  }
});

// ============================================================
// 社交采集系统
// ============================================================

const SOCIAL_ARCHIVE_DIR = '/root/content-archive/social';
const COLLECTOR_SCRIPT = '/root/.openclaw/workspace/skills/social-media-collector/scripts/collector.py';

// 读取某平台最新一条记录的时间
function getSocialPlatformLastItem(platform) {
  const file = path.join(SOCIAL_ARCHIVE_DIR, `${platform}.jsonl`);
  if (!fs.existsSync(file)) return null;
  try {
    const lines = fs.readFileSync(file, 'utf-8').trim().split('\n').filter(Boolean);
    if (!lines.length) return null;
    const last = JSON.parse(lines[lines.length - 1]);
    return { date: last.fetched_at || null };
  } catch { return null; }
}

// API: 社交采集状态
app.get('/api/social/status', (req, res) => {
  try {
    // 检查 RSSHub Docker 容器状态
    let rsshubStatus = 'unknown';
    try {
      const out = execSync('docker inspect --format="{{.State.Status}}" rsshub 2>/dev/null', { encoding: 'utf-8', timeout: 5000 }).trim().replace(/"/g, '');
      rsshubStatus = out === 'running' ? 'running' : 'stopped';
    } catch { rsshubStatus = 'unknown'; }

    // 各平台最新一条
    const platforms = ['youtube', 'weibo', 'tech'];
    const platformLastItems = {};
    for (const p of platforms) {
      const item = getSocialPlatformLastItem(p);
      if (item) platformLastItems[p] = item;
    }

    // 最近一次采集时间（取所有平台中最新的）
    const dates = Object.values(platformLastItems).map(i => i.date).filter(Boolean).sort();
    const lastRun = dates.length ? new Date(dates[dates.length - 1]).getTime() : null;

    res.json({ rsshubStatus, lastRun, platformLastItems });
  } catch (e) {
    res.json({ rsshubStatus: 'unknown', lastRun: null, platformLastItems: {} });
  }
});

// API: 社交内容列表（分页）
app.get('/api/social/items', (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const pageSize = parseInt(req.query.pageSize) || 20;
  const platform = req.query.platform || 'all';

  try {
    if (!fs.existsSync(SOCIAL_ARCHIVE_DIR)) return res.json({ data: [], totalPages: 0 });

    const platforms = platform === 'all' ? ['youtube', 'weibo', 'tech'] : [platform];
    const allItems = [];

    for (const p of platforms) {
      const file = path.join(SOCIAL_ARCHIVE_DIR, `${p}.jsonl`);
      if (!fs.existsSync(file)) continue;
      const lines = fs.readFileSync(file, 'utf-8').trim().split('\n').filter(Boolean);
      for (const line of lines) {
        try {
          const item = JSON.parse(line);
          item._platform = p;
          allItems.push(item);
        } catch {}
      }
    }

    // 按时间倒序
    allItems.sort((a, b) => new Date(b.fetched_at || 0) - new Date(a.fetched_at || 0));

    const total = allItems.length;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const data = allItems.slice((page - 1) * pageSize, page * pageSize);

    res.json({ data, total, totalPages, page });
  } catch (e) {
    res.json({ data: [], total: 0, totalPages: 0, error: e.message });
  }
});

// API: 触发采集（仅管理员）
app.post('/api/social/collect', (req, res) => {
  const cookies = parseCookies(req.headers.cookie);
  const token = cookies[COOKIE_NAME];
  const session = sessions.get(token);
  if (!session || session.role !== 'admin') {
    return res.status(403).json({ ok: false, error: '仅管理员可执行' });
  }

  const { platform } = req.body || {};
  const targets = platform === 'all' ? ['weibo', 'youtube', 'tech'] : [platform];

  const results = {};
  const promises = targets.map(p => new Promise(resolve => {
    const { exec } = require('child_process');
    exec(
      `python3 "${COLLECTOR_SCRIPT}" ${p}`,
      { cwd: path.dirname(COLLECTOR_SCRIPT), timeout: 60000, encoding: 'utf-8' },
      (error, stdout) => {
        if (error) {
          results[p] = { saved: 0, error: error.message.slice(0, 200) };
        } else {
          // 尝试从 stdout 解析保存条数
          const match = stdout.match(/saved[:\s]+(\d+)/i);
          results[p] = { saved: match ? parseInt(match[1]) : 0, error: null };
        }
        resolve();
      }
    );
  }));

  Promise.all(promises).then(() => res.json(results));
});

// ============================================================
// HOOKS 系统
// ============================================================

const HOOKS_FILE = path.join(__dirname, 'hooks.json');
const HOOK_RUNS_DIR = process.env.HOOK_RUNS_DIR || path.join(__dirname, 'hook-runs');
if (!fs.existsSync(HOOK_RUNS_DIR)) fs.mkdirSync(HOOK_RUNS_DIR, { recursive: true });

function loadHooks() {
  try {
    return JSON.parse(fs.readFileSync(HOOKS_FILE, 'utf-8'));
  } catch { return []; }
}

function getHookRuns(hookId) {
  const runFile = path.join(HOOK_RUNS_DIR, `${hookId}.json`);
  try {
    return JSON.parse(fs.readFileSync(runFile, 'utf-8'));
  } catch { return []; }
}

function saveHookRun(hookId, run) {
  const runFile = path.join(HOOK_RUNS_DIR, `${hookId}.json`);
  const runs = getHookRuns(hookId);
  runs.unshift(run);
  fs.writeFileSync(runFile, JSON.stringify(runs.slice(0, 50), null, 2));
}

// API: 获取所有 Hooks
app.get('/api/hooks', (req, res) => {
  try {
    const hooks = loadHooks().map(h => ({
      id: h.id,
      name: h.name,
      description: h.description,
      enabled: h.enabled,
      timeout: h.timeout,
      script: h.script
    }));
    res.json({ ok: true, hooks });
  } catch (e) {
    res.json({ ok: false, error: e.message, hooks: [] });
  }
});

// API: 发现未注册 Hook 的 cron 任务（仅管理员可见）
app.get('/api/hooks/discover', (req, res) => {
  const cookies = parseCookies(req.headers.cookie);
  const token = cookies[COOKIE_NAME];
  const session = sessions.get(token);
  if (!session || session.role !== 'admin') {
    return res.status(403).json({ ok: false, error: '仅管理员可查看' });
  }

  try {
    const hooks = loadHooks();
    const hookJobIds = new Set(hooks.map(h => h.jobId));

    // 获取所有 cron 任务
    const cronOutput = execSync('openclaw cron list --json 2>/dev/null || echo "{\"jobs\":[]}"', { timeout: 10000 });
    let raw = [];
    try { raw = JSON.parse(cronOutput.toString().trim()); } catch {}
    const allJobs = Array.isArray(raw) ? raw : (raw.jobs || []);

    // 过滤出还没有 Hook 的任务
    const orphanJobs = allJobs
      .filter(j => j.id && !hookJobIds.has(j.id))
      .map(j => ({
        id: j.id,
        name: j.name || j.id,
        schedule: j.schedule?.expr || '',
        enabled: j.enabled
      }));

    res.json({ ok: true, orphans: orphanJobs });
  } catch (e) {
    res.json({ ok: false, error: e.message, orphans: [] });
  }
});

// API: 为指定 cron 任务创建 Hook（仅管理员）
app.post('/api/hooks/from-job', (req, res) => {
  const cookies = parseCookies(req.headers.cookie);
  const token = cookies[COOKIE_NAME];
  const session = sessions.get(token);
  if (!session || session.role !== 'admin') {
    return res.status(403).json({ ok: false, error: '仅管理员可操作' });
  }

  const { jobId, jobName } = req.body || {};
  if (!jobId) return res.json({ ok: false, error: '缺少 jobId' });

  try {
    const hooks = loadHooks();
    const hookId = `hook-${jobId.slice(0, 8)}`;
    if (hooks.find(h => h.id === hookId)) {
      return res.json({ ok: false, error: `Hook '${hookId}' 已存在` });
    }

    const newHook = {
      id: hookId,
      name: jobName || jobId,
      description: `触发 cron 任务：${jobName || jobId}`,
      script: `openclaw cron trigger ${jobId}`,
      enabled: true,
      timeout: 300,
      jobId: jobId
    };

    hooks.push(newHook);
    fs.writeFileSync(HOOKS_FILE, JSON.stringify(hooks, null, 2));
    res.json({ ok: true, hook: { id: newHook.id, name: newHook.name } });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});

// API: 触发 Hook（仅管理员可执行）
app.post('/api/hooks/:id/execute', (req, res) => {
  const cookies = parseCookies(req.headers.cookie);
  const token = cookies[COOKIE_NAME];
  const session = sessions.get(token);
  if (!session || session.role !== 'admin') {
    return res.status(403).json({ ok: false, error: '仅管理员可执行此操作', requireAdmin: true });
  }

  const { id } = req.params;
  const hooks = loadHooks();
  const hook = hooks.find(h => h.id === id);
  if (!hook) return res.json({ ok: false, error: `Hook '${id}' 不存在` });
  if (!hook.enabled) return res.json({ ok: false, error: `Hook '${id}' 已禁用` });

  const runId = `run-${Date.now()}`;
  const logFile = `/tmp/hook_${id}_${Date.now()}.log`;

  // 立即返回，不阻塞
  res.json({ ok: true, runId, message: `Hook '${hook.name}' 已触发，运行中...` });

  // script 字段可能是文件路径（/path/to/script.sh）或 shell 命令（openclaw cron trigger ...）
  const shellCmd = hook.script.startsWith('/') ? `bash "${hook.script}"` : hook.script;

  // 异步执行
  const { exec } = require('child_process');
  const child = exec(
    `${shellCmd} > "${logFile}" 2>&1; echo "EXIT:$?"`,
    { cwd: hook.workingDir || '/tmp', timeout: hook.timeout * 1000 },
    (error, stdout, stderr) => {
      const exitCode = stdout.includes('EXIT:') ? parseInt(stdout.split('EXIT:')[1]) : 1;
      const status = exitCode === 0 ? 'success' : 'failed';
      const log = fs.existsSync(logFile) ? fs.readFileSync(logFile, 'utf-8').slice(-2000) : '';
      const run = {
        runId,
        startedAt: new Date().toISOString(),
        finishedAt: new Date().toISOString(),
        status,
        exitCode,
        log,
        trigger: 'api'
      };
      saveHookRun(id, run);
    }
  );
});

// API: 获取 Hook 执行历史
app.get('/api/hooks/:id/runs', (req, res) => {
  const { id } = req.params;
  const runs = getHookRuns(id);
  res.json({ ok: true, runs });
});

// ============================================================
// LJ-G Chat API
// ============================================================

app.post('/api/ljg/chat', async (req, res) => {
  const { message, skill, conversation } = req.body;
  if (!message) return res.status(400).json({ ok: false, error: 'message is required' });

  // 构建 prompt，注入 skill 上下文
  const skillName = skill === 'auto' ? '' : skill;
  let systemPrompt = `你是 LJ-G 工作台的 AI 助手。`;
  if (skillName) {
    systemPrompt += ` 当前激活的技能是 ${skillName}，请按照该技能的 SKILL.md 规范执行。`;
  } else {
    systemPrompt += ` 请根据用户输入内容自动判断最适合的技能并执行。可用技能：ljg-writes, ljg-word, ljg-word-flow, ljg-plain, ljg-invest, ljg-rank, ljg-paper, ljg-paper-flow, ljg-card, ljg-skill-map, ljg-roundtable, ljg-learn, ljg-x-download。`;
  }

  // 构建消息历史
  const messages = [
    { role: 'system', content: systemPrompt },
    ...(conversation || []).slice(-10).map(m => ({ role: m.role, content: m.content })),
    { role: 'user', content: message }
  ];

  try {
    // 调用 fusecode.cc (Claude Code 后端)
    const axios = require('axios');
    const response = await axios.post('https://www.fusecode.cc/v1/messages', {
      model: 'claude-opus-4-6',
      messages: messages.filter(m => m.role !== 'system'),
      system: messages.find(m => m.role === 'system')?.content,
      max_tokens: 4096
    }, {
      timeout: 60000,
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': 'sk-f7cc027928ef0a2bd0b8d24bf882d138390f55220a1cd5a43e8d9d7d862a1eb7',
        'anthropic-version': '2023-06-01'
      }
    });

    const reply = response.data?.content?.[0]?.text || '处理完成。';
    res.json({ ok: true, reply });
  } catch (e) {
    console.error('LJ-G chat error:', e.message);
    // fallback: 返回友好错误
    res.json({ ok: false, reply: '⚠️ 服务暂时不可用，请稍后再试。' });
  }
});

// ============================================================
// 兜底路由
// ============================================================

// 兜底 - 匹配所有未匹配路由
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Workflow Console 运行中 → http://0.0.0.0:${PORT}`);
});
