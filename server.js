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
app.use(express.static(path.join(__dirname, 'public')));

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
    mdArchive: true,
    mdArchivePath: 'content-archive/skill-updates/YYYY-MM-DD.md',
    description: '每日热门 Skill 更新汇总'
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
    description: 'Memory Dreaming 增强任务'
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
