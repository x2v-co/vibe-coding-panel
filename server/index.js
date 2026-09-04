import express from 'express';
import { spawn } from 'node:child_process';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { access, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { homedir, hostname, tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PairingStore, isLoopbackRequest, readCookie } from './pairing.js';
import { buildWhisperArgs, resolveWhisperModel, resolveWhisperTimeout } from './whisper-options.js';

const app = express();
const port = Number(process.env.PANEL_API_PORT || 8787);
const bridgePort = Number(process.env.PANEL_BRIDGE_PORT || 8788);
const bridgeHost = process.env.PANEL_BRIDGE_HOST || '127.0.0.1';
const bridgeToken = process.env.PANEL_BRIDGE_TOKEN || '';
const agentName = process.env.PANEL_AGENT_NAME || hostname();
const pairingRequired = ['1', 'true', 'yes'].includes(String(process.env.PANEL_REQUIRE_PAIRING || '').toLowerCase());
const jobs = new Map();
const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const terminalStatuses = new Set(['completed', 'failed', 'stopped']);
const pairingStore = new PairingStore({
  filePath: process.env.PANEL_DEVICE_STORE || path.join(homedir(), '.vibe-panel', 'devices.json'),
});
const pairingAttempts = new Map();

await pairingStore.init();

app.use(express.json({ limit: '12mb' }));

function requestUsesHttps(req) {
  if (req.secure) return true;
  const forwarded = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
  if (forwarded === 'https') return true;
  try { return JSON.parse(String(req.headers['cf-visitor'] || '{}')).scheme === 'https'; } catch { return false; }
}

function setDeviceCookie(req, res, token) {
  const attributes = [
    `vibe_panel_device=${encodeURIComponent(token)}`,
    'HttpOnly', 'SameSite=Strict', 'Path=/', 'Max-Age=31536000',
  ];
  if (requestUsesHttps(req)) attributes.push('Secure');
  res.setHeader('Set-Cookie', attributes.join('; '));
}

function pairingClientKey(req) {
  return String(req.headers['cf-connecting-ip'] || req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown')
    .split(',')[0].trim();
}

function canAttemptPairing(req) {
  const key = pairingClientKey(req);
  const now = Date.now();
  const recent = (pairingAttempts.get(key) || []).filter((at) => now - at < 10 * 60 * 1000);
  recent.push(now);
  pairingAttempts.set(key, recent);
  return recent.length <= 10;
}

function parsePublicUrl(input) {
  const url = new URL(String(input || '').trim());
  const localHttp = url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.protocol !== 'https:' && !localHttp) throw new Error('手机入口必须使用 HTTPS');
  url.pathname = '/';
  url.search = '';
  url.hash = '';
  return url.toString();
}

async function authenticatedDevice(req) {
  return pairingStore.authenticate(readCookie(req.headers.cookie, 'vibe_panel_device'));
}

function push(job, event) {
  const entry = { id: ++job.sequence, at: Date.now(), ...event };
  job.events.push(entry);
  if (job.events.length > 500) job.events.shift();
  for (const listener of job.listeners) listener(entry);
}

function parseCodexLine(job, line) {
  if (!line.trim()) return;
  try {
    const data = JSON.parse(line);
    if (data.thread_id && !job.threadId) job.threadId = data.thread_id;
    if (data.type === 'thread.started') job.threadId = data.thread_id;
    const item = data.item || {};
    const type = item.type || data.type || 'event';
    if (type === 'agent_message') {
      const text = item.text || item.content || '';
      job.result = text;
      push(job, { type: 'message', text });
    } else if (type === 'reasoning') {
      push(job, { type: 'progress', text: item.text || '正在思考下一步' });
    } else if (type === 'command_execution') {
      const phase = item.status === 'completed' ? '已完成命令' : '正在执行命令';
      push(job, { type: 'tool', text: `${phase}: ${item.command || ''}`, status: item.status });
    } else if (data.type === 'turn.completed') {
      push(job, { type: 'progress', text: '正在整理结果' });
    }
  } catch {
    push(job, { type: 'log', text: line });
  }
}

function shouldShowStderr(line) {
  return line.trim() && !line.includes(' WARN ')
    && line.trim() !== 'Reading additional input from stdin...';
}

function createJob(prompt, cwd) {
  return {
    id: randomUUID(), cwd, prompt, status: 'queued', threadId: null,
    events: [], listeners: new Set(), sequence: 0, process: null, remote: null,
    createdAt: Date.now(), startedAt: null, finishedAt: null, result: '',
  };
}

function launch(job, prompt, resume = false) {
  const args = resume
    ? ['exec', 'resume', job.threadId, prompt, '--json', '--skip-git-repo-check']
    : ['exec', prompt, '--json', '--skip-git-repo-check', '--approve-for-me', '--cd', job.cwd];
  job.status = 'running';
  job.startedAt = Date.now();
  job.finishedAt = null;
  job.result = '';
  push(job, { type: 'status', status: 'running', text: resume ? '正在继续任务' : 'Agent 已开始工作' });

  const child = spawn('codex', args, { cwd: job.cwd, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
  job.process = child;
  let stdoutBuffer = '';
  let stderrBuffer = '';
  child.stdout.on('data', (chunk) => {
    stdoutBuffer += chunk.toString();
    const lines = stdoutBuffer.split(/\r?\n/);
    stdoutBuffer = lines.pop() || '';
    for (const line of lines) parseCodexLine(job, line);
  });
  child.stderr.on('data', (chunk) => {
    stderrBuffer += chunk.toString();
    const lines = stderrBuffer.split(/\r?\n/);
    stderrBuffer = lines.pop() || '';
    for (const line of lines) if (shouldShowStderr(line)) push(job, { type: 'log', text: line });
  });
  child.on('error', (error) => {
    job.status = 'failed';
    job.finishedAt = Date.now();
    push(job, { type: 'status', status: 'failed', text: error.message });
  });
  child.on('close', (code, signal) => {
    if (stdoutBuffer) parseCodexLine(job, stdoutBuffer);
    if (shouldShowStderr(stderrBuffer)) push(job, { type: 'log', text: stderrBuffer });
    job.process = null;
    job.finishedAt = Date.now();
    job.status = signal ? 'stopped' : code === 0 ? 'completed' : 'failed';
    push(job, {
      type: 'status', status: job.status,
      text: job.status === 'completed' ? '任务完成' : job.status === 'stopped' ? '任务已停止' : `任务失败（退出码 ${code}）`,
    });
  });
}

function parseRemoteConnection(input) {
  if (input?.mode !== 'remote') return null;
  const token = String(input.token || '').trim();
  if (!token) throw new Error('请输入远程配对令牌');
  let url;
  try {
    url = new URL(String(input.url || '').trim());
  } catch {
    throw new Error('远程地址格式无效');
  }
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('远程地址必须使用 HTTP 或 HTTPS');
  return { baseUrl: `${url.protocol}//${url.host}`, token };
}

function remoteHeaders(remote, json = false) {
  return { Authorization: `Bearer ${remote.token}`, ...(json ? { 'Content-Type': 'application/json' } : {}) };
}

async function remoteJson(remote, route, options = {}, timeoutMs = 15000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${remote.baseUrl}${route}`, {
      ...options,
      headers: { ...remoteHeaders(remote, Boolean(options.body)), ...(options.headers || {}) },
      signal: controller.signal,
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `远程 Agent 返回 ${response.status}`);
    return payload;
  } catch (error) {
    if (error?.name === 'AbortError') throw new Error('远程 Agent 连接超时');
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function applyRemoteEvent(job, remoteEvent) {
  const { id: _remoteId, at: _remoteAt, ...event } = remoteEvent;
  if (event.type === 'message' && event.text) job.result = event.text;
  if (event.type === 'status' && event.status) {
    job.status = event.status;
    if (event.status === 'running' && !job.startedAt) job.startedAt = Date.now();
    if (terminalStatuses.has(event.status)) job.finishedAt = Date.now();
  }
  push(job, event);
  return event.type === 'status' && terminalStatuses.has(event.status);
}

async function pumpRemoteEvents(job) {
  try {
    const response = await fetch(`${job.remote.baseUrl}/bridge/jobs/${job.remote.id}/events`, {
      headers: remoteHeaders(job.remote),
    });
    if (!response.ok || !response.body) {
      const payload = await response.json().catch(() => ({}));
      throw new Error(payload.error || `无法订阅远程 Agent（${response.status}）`);
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
      const blocks = buffer.split(/\r?\n\r?\n/);
      buffer = blocks.pop() || '';
      for (const block of blocks) {
        const data = block.split(/\r?\n/)
          .filter((line) => line.startsWith('data:'))
          .map((line) => line.slice(5).trimStart()).join('\n');
        if (!data) continue;
        try {
          if (applyRemoteEvent(job, JSON.parse(data))) {
            await reader.cancel();
            return;
          }
        } catch {
          // Ignore malformed upstream keep-alive payloads.
        }
      }
      if (done) break;
    }
    if (!terminalStatuses.has(job.status)) throw new Error('远程 Agent 状态流已中断');
  } catch (error) {
    if (terminalStatuses.has(job.status)) return;
    job.status = 'failed';
    job.finishedAt = Date.now();
    push(job, { type: 'status', status: 'failed', text: error instanceof Error ? error.message : '远程 Agent 连接失败' });
  }
}

async function saveCapture(cwdInput, imageInput) {
  const cwd = path.resolve(String(cwdInput || process.cwd()));
  const match = String(imageInput || '').match(/^data:image\/(png|jpeg);base64,([A-Za-z0-9+/=]+)$/);
  if (!match) throw Object.assign(new Error('截图格式无效'), { status: 400 });
  const bytes = Buffer.from(match[2], 'base64');
  if (bytes.length > 8 * 1024 * 1024) throw Object.assign(new Error('截图超过 8 MB'), { status: 413 });
  await access(cwd);
  const captureDir = path.join(cwd, '.vibe-panel', 'captures');
  await mkdir(captureDir, { recursive: true });
  const extension = match[1] === 'jpeg' ? 'jpg' : 'png';
  const filePath = path.join(captureDir, `screen-${Date.now()}.${extension}`);
  await writeFile(filePath, bytes);
  return filePath;
}

async function listWorkspaceDirectories(pathInput) {
  const directoryPath = path.resolve(String(pathInput || process.cwd()));
  const entries = await readdir(directoryPath, { withFileTypes: true });
  const directories = entries
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
    .map((entry) => ({ name: entry.name, path: path.join(directoryPath, entry.name) }))
    .sort((left, right) => left.name.localeCompare(right.name, undefined, { numeric: true }));
  const root = path.parse(directoryPath).root;
  return { path: directoryPath, parent: directoryPath === root ? null : path.dirname(directoryPath), directories };
}

async function localWorkspaceHandler(req, res) {
  try {
    res.json(await listWorkspaceDirectories(req.body?.path));
  } catch (error) {
    res.status(error.code === 'ENOENT' ? 404 : 400).json({ error: error.message || '无法读取该目录' });
  }
}

function runProcess(command, args, timeoutMs = 120000, env = process.env) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error('语音转写超时；首次使用可能仍在下载模型，请重试'));
    }, timeoutMs);
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error.code === 'ENOENT'
        ? new Error('本机未安装 Whisper，请设置 PANEL_WHISPER_BIN')
        : error);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(stderr.trim().split(/\r?\n/).pop() || `Whisper 退出码 ${code}`));
    });
  });
}

function readProcess(command, args, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { env: process.env, stdio: ['ignore', 'pipe', 'ignore'] });
    let stdout = '';
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('命令超时')); }, timeoutMs);
    child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    child.on('error', (error) => { clearTimeout(timer); reject(error); });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(stdout.trim());
      else reject(new Error(`命令退出码 ${code}`));
    });
  });
}

let bundledFfmpegPromise;
function findBundledFfmpeg() {
  if (process.env.PANEL_FFMPEG_BIN) return Promise.resolve(process.env.PANEL_FFMPEG_BIN);
  bundledFfmpegPromise ||= readProcess(process.env.PANEL_PYTHON_BIN || 'python3', [
    '-c', 'import imageio_ffmpeg; print(imageio_ffmpeg.get_ffmpeg_exe())',
  ]).catch(() => '');
  return bundledFfmpegPromise;
}

async function transcribeAudio(audioInput, languageInput) {
  const match = String(audioInput || '').match(/^data:audio\/([A-Za-z0-9.+-]+)(?:;[^,]*)?;base64,([A-Za-z0-9+/=]+)$/);
  if (!match) throw Object.assign(new Error('录音格式无效'), { status: 400 });
  const bytes = Buffer.from(match[2], 'base64');
  if (!bytes.length) throw Object.assign(new Error('录音内容为空'), { status: 400 });
  if (bytes.length > 10 * 1024 * 1024) throw Object.assign(new Error('录音超过 10 MB，请缩短后重试'), { status: 413 });
  const extensions = { webm: 'webm', mp4: 'm4a', 'x-m4a': 'm4a', ogg: 'ogg', mpeg: 'mp3', wav: 'wav' };
  const extension = extensions[match[1].toLowerCase()] || 'webm';
  const workDir = await mkdtemp(path.join(tmpdir(), 'vibe-panel-audio-'));
  const inputPath = path.join(workDir, `speech.${extension}`);
  try {
    await writeFile(inputPath, bytes);
    const whisperBin = process.env.PANEL_WHISPER_BIN || 'whisper';
    const model = resolveWhisperModel();
    const language = String(languageInput || 'zh').replace(/[^A-Za-z-]/g, '') || 'zh';
    const bundledFfmpeg = await findBundledFfmpeg();
    let whisperEnv = process.env;
    if (bundledFfmpeg) {
      await symlink(bundledFfmpeg, path.join(workDir, 'ffmpeg'));
      whisperEnv = { ...process.env, PATH: `${workDir}${path.delimiter}${process.env.PATH || ''}` };
    }
    await runProcess(
      whisperBin,
      buildWhisperArgs(inputPath, model, language, workDir),
      resolveWhisperTimeout(),
      whisperEnv,
    );
    try {
      return (await readFile(path.join(workDir, 'speech.txt'), 'utf8')).trim();
    } catch {
      throw new Error('Whisper 未生成转写结果，请检查本机 ffmpeg 配置');
    }
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

async function localCaptureHandler(req, res) {
  try {
    const filePath = await saveCapture(req.body?.cwd, req.body?.image);
    res.status(201).json({ path: filePath });
  } catch (error) {
    res.status(error.status || 400).json({ error: error.message || '无法在工作目录保存截图' });
  }
}

async function localCreateJobHandler(req, res) {
  const prompt = String(req.body?.prompt || '').trim();
  const cwd = path.resolve(String(req.body?.cwd || process.cwd()));
  if (!prompt) return res.status(400).json({ error: '请输入任务内容' });
  try {
    await access(cwd);
  } catch {
    return res.status(400).json({ error: '工作目录不存在' });
  }
  const job = createJob(prompt, cwd);
  jobs.set(job.id, job);
  launch(job, prompt);
  res.status(201).json({ id: job.id });
}

function getJobHandler(req, res) {
  const job = jobs.get(req.params.id);
  if (!job) return res.status(404).json({ error: '任务不存在' });
  const { process: _process, listeners: _listeners, remote: _remote, ...safeJob } = job;
  res.json(safeJob);
}

function eventsHandler(req, res) {
  const job = jobs.get(req.params.id);
  if (!job) return res.status(404).end();
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();
  const after = Number(req.query.after || 0);
  for (const event of job.events.filter((item) => item.id > after)) res.write(`data: ${JSON.stringify(event)}\n\n`);
  const listener = (event) => res.write(`data: ${JSON.stringify(event)}\n\n`);
  job.listeners.add(listener);
  const keepAlive = setInterval(() => res.write(': ping\n\n'), 15000);
  req.on('close', () => {
    clearInterval(keepAlive);
    job.listeners.delete(listener);
  });
}

function localStopHandler(req, res) {
  const job = jobs.get(req.params.id);
  if (!job) return res.status(404).json({ error: '任务不存在' });
  if (job.process && job.status === 'running') job.process.kill('SIGINT');
  res.json({ ok: true });
}

function localFollowUpHandler(req, res) {
  const job = jobs.get(req.params.id);
  const prompt = String(req.body?.prompt || '').trim();
  if (!job) return res.status(404).json({ error: '任务不存在' });
  if (!prompt) return res.status(400).json({ error: '请输入后续指令' });
  if (job.status === 'running') return res.status(409).json({ error: '当前任务仍在运行' });
  if (!job.threadId) return res.status(409).json({ error: '该任务无法继续，请新建任务' });
  job.events = [];
  job.sequence = 0;
  launch(job, prompt, true);
  res.json({ ok: true });
}

app.get('/api/health', async (req, res) => {
  const local = isLoopbackRequest(req);
  const device = local ? null : await authenticatedDevice(req);
  res.json({
    ok: true,
    agent: 'Codex CLI',
    mode: 'local',
    name: agentName,
    pairingRequired: pairingRequired && !local,
    paired: !pairingRequired || local || Boolean(device),
    device,
    demoAvailable: true,
  });
});

app.post('/api/pair', async (req, res) => {
  if (!canAttemptPairing(req)) return res.status(429).json({ error: '配对尝试过多，请 10 分钟后重试' });
  try {
    const paired = await pairingStore.exchange(req.body?.code, {
      name: req.body?.deviceName,
      userAgent: req.headers['user-agent'],
    });
    setDeviceCookie(req, res, paired.token);
    res.status(201).json({ ok: true, device: paired.device });
  } catch (error) {
    res.status(400).json({ error: error.message || '配对失败' });
  }
});

app.post('/api/pairing-codes', (req, res) => {
  if (!isLoopbackRequest(req)) return res.status(403).json({ error: '只能在 Agent 电脑上生成配对码' });
  try {
    const publicUrl = parsePublicUrl(req.body?.publicUrl || `${req.protocol}://${req.get('host')}`);
    const pairing = pairingStore.createCode();
    const pairingUrl = new URL(publicUrl);
    pairingUrl.searchParams.set('pair', pairing.code);
    res.status(201).json({ ...pairing, pairingUrl: pairingUrl.toString() });
  } catch (error) {
    res.status(400).json({ error: error.message || '无法生成配对码' });
  }
});

app.get('/api/devices', (req, res) => {
  if (!isLoopbackRequest(req)) return res.status(403).json({ error: '只能在 Agent 电脑上管理设备' });
  res.json({ devices: pairingStore.listDevices() });
});

app.delete('/api/devices/:id', async (req, res) => {
  if (!isLoopbackRequest(req)) return res.status(403).json({ error: '只能在 Agent 电脑上管理设备' });
  const revoked = await pairingStore.revoke(req.params.id);
  res.status(revoked ? 200 : 404).json(revoked ? { ok: true } : { error: '设备不存在' });
});

app.use('/api', async (req, res, next) => {
  if (!pairingRequired || isLoopbackRequest(req)) return next();
  try {
    const device = await authenticatedDevice(req);
    if (!device) return res.status(401).json({ error: '设备尚未配对', code: 'PAIRING_REQUIRED' });
    req.panelDevice = device;
    next();
  } catch {
    res.status(500).json({ error: '无法验证设备授权' });
  }
});

app.post('/api/transcriptions', async (req, res) => {
  try {
    const text = await transcribeAudio(req.body?.audio, req.body?.language);
    res.json({ text });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || '录音转写失败' });
  }
});

app.post('/api/workspaces', async (req, res) => {
  try {
    const remote = parseRemoteConnection(req.body?.connection);
    if (!remote) return localWorkspaceHandler(req, res);
    const payload = await remoteJson(remote, '/bridge/workspaces', {
      method: 'POST', body: JSON.stringify({ path: req.body?.path }),
    });
    res.json(payload);
  } catch (error) {
    res.status(error.status || 502).json({ error: error.message || '无法读取远程目录' });
  }
});

app.post('/api/connections/test', async (req, res) => {
  try {
    const remote = parseRemoteConnection(req.body?.connection);
    if (!remote) return res.json({ ok: true, mode: 'local', name: agentName, agent: 'Codex CLI' });
    const health = await remoteJson(remote, '/bridge/health', {}, 6000);
    res.json({ ok: true, mode: 'remote', name: health.name || 'Remote Agent', agent: health.agent || 'Codex CLI' });
  } catch (error) {
    res.status(502).json({ error: error.message || '无法连接远程 Agent' });
  }
});

app.post('/api/captures', async (req, res) => {
  try {
    const remote = parseRemoteConnection(req.body?.connection);
    if (!remote) return localCaptureHandler(req, res);
    const payload = await remoteJson(remote, '/bridge/captures', {
      method: 'POST', body: JSON.stringify({ cwd: req.body?.cwd, image: req.body?.image }),
    }, 30000);
    res.status(201).json(payload);
  } catch (error) {
    res.status(error.status || 502).json({ error: error.message || '远程截图保存失败' });
  }
});

app.post('/api/jobs', async (req, res) => {
  const prompt = String(req.body?.prompt || '').trim();
  if (!prompt) return res.status(400).json({ error: '请输入任务内容' });
  try {
    const remote = parseRemoteConnection(req.body?.connection);
    if (!remote) return localCreateJobHandler(req, res);
    const cwd = String(req.body?.cwd || '').trim();
    if (!cwd) return res.status(400).json({ error: '请输入远程工作目录' });
    const payload = await remoteJson(remote, '/bridge/jobs', {
      method: 'POST', body: JSON.stringify({ prompt, cwd }),
    }, 30000);
    const job = createJob(prompt, cwd);
    job.remote = { ...remote, id: payload.id };
    jobs.set(job.id, job);
    void pumpRemoteEvents(job);
    res.status(201).json({ id: job.id });
  } catch (error) {
    res.status(502).json({ error: error.message || '远程任务启动失败' });
  }
});

app.get('/api/jobs/:id', getJobHandler);
app.get('/api/jobs/:id/events', eventsHandler);

app.post('/api/jobs/:id/stop', async (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) return res.status(404).json({ error: '任务不存在' });
  if (!job.remote) return localStopHandler(req, res);
  try {
    await remoteJson(job.remote, `/bridge/jobs/${job.remote.id}/stop`, { method: 'POST' });
    res.json({ ok: true });
  } catch (error) {
    res.status(502).json({ error: error.message || '无法停止远程任务' });
  }
});

app.post('/api/jobs/:id/follow-up', async (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) return res.status(404).json({ error: '任务不存在' });
  if (!job.remote) return localFollowUpHandler(req, res);
  const prompt = String(req.body?.prompt || '').trim();
  if (!prompt) return res.status(400).json({ error: '请输入后续指令' });
  if (job.status === 'running') return res.status(409).json({ error: '当前任务仍在运行' });
  try {
    await remoteJson(job.remote, `/bridge/jobs/${job.remote.id}/follow-up`, {
      method: 'POST', body: JSON.stringify({ prompt }),
    }, 30000);
    job.events = [];
    job.sequence = 0;
    job.status = 'queued';
    job.result = '';
    job.startedAt = null;
    job.finishedAt = null;
    void pumpRemoteEvents(job);
    res.json({ ok: true });
  } catch (error) {
    res.status(502).json({ error: error.message || '无法继续远程任务' });
  }
});

app.use(express.static(path.join(appRoot, 'dist')));
app.use((req, res, next) => {
  if (req.method !== 'GET' || req.path.startsWith('/api/')) return next();
  res.sendFile(path.join(appRoot, 'dist', 'index.html'));
});

app.listen(port, '127.0.0.1', () => console.log(`Vibe Panel API: http://127.0.0.1:${port}`));

function tokenMatches(candidate) {
  const expected = Buffer.from(bridgeToken);
  const received = Buffer.from(candidate || '');
  return expected.length === received.length && timingSafeEqual(expected, received);
}

if (bridgeToken) {
  const bridge = express();
  bridge.use(express.json({ limit: '12mb' }));
  bridge.use((req, res, next) => {
    const authorization = String(req.headers.authorization || '');
    if (!tokenMatches(authorization.replace(/^Bearer\s+/i, ''))) return res.status(401).json({ error: '远程配对令牌无效' });
    next();
  });
  bridge.get('/bridge/health', (_req, res) => res.json({ ok: true, name: agentName, agent: 'Codex CLI' }));
  bridge.post('/bridge/workspaces', localWorkspaceHandler);
  bridge.post('/bridge/captures', localCaptureHandler);
  bridge.post('/bridge/jobs', localCreateJobHandler);
  bridge.get('/bridge/jobs/:id', getJobHandler);
  bridge.get('/bridge/jobs/:id/events', eventsHandler);
  bridge.post('/bridge/jobs/:id/stop', localStopHandler);
  bridge.post('/bridge/jobs/:id/follow-up', localFollowUpHandler);
  bridge.listen(bridgePort, bridgeHost, () => console.log(`Remote Agent Bridge: http://${bridgeHost}:${bridgePort}/bridge`));
}
