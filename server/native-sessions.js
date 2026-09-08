import { open, readdir, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { homedir } from 'node:os';
import { createInterface } from 'node:readline';
import spawn from 'cross-spawn';

const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const text = (v) => typeof v === 'string' ? v : Array.isArray(v) ? v.map((x) => x?.text || '').join('\n') : '';
const title = (v) => String(v || '').replace(/\s+/g, ' ').trim().slice(0, 120);
const time = (v) => typeof v === 'number' ? (v < 1e12 ? v * 1000 : v) : Date.parse(v || '') || 0;
function error(message, status = 400) { return Object.assign(new Error(message), { status }); }

export async function workspacePath(value) {
  if (!String(value || '').trim()) throw error('请先选择 Workspace');
  let resolved;
  try { resolved = await realpath(String(value)); } catch { throw error('Workspace 不存在'); }
  if (!(await stat(resolved)).isDirectory()) throw error('Workspace 必须是目录');
  return resolved;
}

async function transcript(file, limit = 512 * 1024) {
  const fh = await open(file); try {
    const size = (await fh.stat()).size; const buf = Buffer.alloc(Math.min(size, limit)); await fh.read(buf, 0, buf.length, 0);
    let raw = buf.toString();
    if (size > limit) {
      raw = raw.slice(0, raw.lastIndexOf('\n') + 1);
      const tail = Buffer.alloc(Math.min(limit, size - limit));
      await fh.read(tail, 0, tail.length, size - tail.length);
      const end = tail.toString();
      raw += end.slice(end.indexOf('\n') + 1);
    }
    const rows = []; for (const line of raw.split(/\r?\n/)) { try { const row = JSON.parse(line); if (row) rows.push(row); } catch {} }
    return { rows, size, truncated: size > limit };
  } finally { await fh.close(); }
}

export class CodexSessionReader {
  constructor(env = process.env) { this.env = env; this.pending = new Map(); this.seq = 0; }
  async start() { if (this.ready) return this.ready; this.ready = this.boot(); try { await this.ready; } catch (e) { this.close(); throw e; } }
  async boot() {
    this.child = spawn(this.env.PANEL_CODEX_BIN || 'codex', ['app-server'], { env: this.env, stdio: ['pipe', 'pipe', 'ignore'] });
    const disconnected = () => {
      for (const request of this.pending.values()) request.reject(error('Codex 会话服务已断开，请检查 CLI 版本', 502));
      this.pending.clear(); this.ready = null;
    };
    this.child.on('error', disconnected);
    this.child.stdin.on('error', disconnected);
    this.child.on('exit', disconnected);
    this.lines = createInterface({ input: this.child.stdout }); this.lines.on('line', (line) => { let m; try { m = JSON.parse(line); } catch { return; } const p = this.pending.get(m.id); if (!p) return; this.pending.delete(m.id); m.error ? p.reject(error(m.error.message || 'Codex 会话读取失败', 502)) : p.resolve(m.result); });
    await this.call('initialize', { clientInfo: { name: 'vibe_panel_sessions', version: '0.1.0' } }); this.child.stdin.write('{"method":"initialized","params":{}}\n');
  }
  call(method, params) { return this.startThenRequest(method, params); }
  async startThenRequest(method, params) {
    if (method !== 'initialize') await this.start();
    return new Promise((resolve, reject) => {
      const id = ++this.seq;
      const timer = setTimeout(() => { this.pending.delete(id); reject(error('Codex 会话读取超时', 504)); }, 20000);
      this.pending.set(id, {
        resolve: (value) => { clearTimeout(timer); resolve(value); },
        reject: (reason) => { clearTimeout(timer); reject(reason); },
      });
      this.child.stdin.write(`${JSON.stringify({ id, method, params })}\n`);
    });
  }
  close() {
    for (const request of this.pending.values()) request.reject(error('Codex 会话服务已关闭', 502));
    this.pending.clear(); this.lines?.close(); this.child?.kill('SIGTERM'); this.ready = null;
  }
}

export class NativeSessions {
  constructor({ env = process.env, codex = new CodexSessionReader(env), alive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } } } = {}) { this.env = env; this.codex = codex; this.alive = alive; this.claudeRoot = env.CLAUDE_CONFIG_DIR || env.CLAUDE_HOME || path.join(homedir(), '.claude'); this.cache = new Map(); }
  close() { this.codex.close?.(); }
  async attached(provider, id) {
    if (provider === 'codex') {
      // Codex owns this lock. Never remove it or modify its session files.
      const lock = path.join(this.env.CODEX_HOME || path.join(homedir(), '.codex'), 'thread-writer-locks', `${id}.lock`);
      // Lock-file existence is not proof of ownership; use the OS lock probe.
      // lsof identifies a currently open writer on macOS/Linux. On Windows,
      // active turn metadata below remains the available read-only signal.
      if (process.platform === 'win32') return false;
      return new Promise((resolve) => {
        const child = spawn('lsof', ['-t', '--', lock], { stdio: ['ignore', 'pipe', 'ignore'] });
        let output = ''; child.stdout.on('data', b => { output += b; });
        child.on('error', () => resolve(false));
        child.on('close', () => resolve(output.trim().length > 0));
        const timer = setTimeout(() => { child.kill(); resolve(true); }, 3000);
        child.on('close', () => clearTimeout(timer));
      });
    }
    const dir = path.join(this.claudeRoot, 'sessions');
    let names; try { names = await readdir(dir); } catch { return false; }
    for (const name of names.filter(n => /^\d+\.json$/.test(n))) {
      try {
        const { rows } = await transcript(path.join(dir, name), 16384);
        if (rows.some(r => r.sessionId === id && Number.isInteger(r.pid) && r.pid > 0 && this.alive(r.pid))) return true;
      } catch { /* A terminal can exit during enumeration. */ }
    }
    return false;
  }
  async claudeFiles() {
    const root = path.join(this.claudeRoot, 'projects');
    let dirs;
    try { dirs = await readdir(root, { withFileTypes: true }); }
    catch (reason) { if (reason.code === 'ENOENT') return []; throw reason; }
    const files = [];
    for (const dir of dirs.filter(entry => entry.isDirectory())) {
      let entries;
      try { entries = await readdir(path.join(root, dir.name), { withFileTypes: true }); }
      catch (reason) { if (reason.code === 'ENOENT') continue; throw reason; }
      // Subagent transcripts and memory files are not resumable user sessions.
      for (const file of entries) if (file.isFile() && file.name.endsWith('.jsonl') && uuid.test(file.name.slice(0, -6))) {
        files.push(path.join(root, dir.name, file.name));
      }
    }
    return files;
  }
  async claudeInfo(file) {
    const info = await stat(file), cached = this.cache.get(file);
    if (cached && cached.mtime === info.mtimeMs && cached.size === info.size) return cached.value;
    const { rows, truncated } = await transcript(file);
    const id = path.basename(file, '.jsonl');
    const records = rows.filter(r => r.sessionId === id && !r.isSidechain);
    const recordedCwd = records.find(r => r.cwd)?.cwd;
    if (!recordedCwd) return null;
    const cwd = await workspacePath(recordedCwd);
    const messages = records.filter(r => ['user', 'assistant'].includes(r.type) && !r.isMeta)
      .map(r => ({ role: r.type, text: text(r.message?.content).slice(0, 16000), at: time(r.timestamp) })).filter(r => r.text);
    const value = { id, provider: 'claude', cwd, title: title(records.findLast(r => r.type === 'custom-title')?.customTitle || messages.find(m => m.role === 'user')?.text) || id,
      updatedAt: info.mtimeMs, messages: messages.slice(-100), truncated: truncated || messages.length > 100 };
    if (this.cache.size >= 300) this.cache.delete(this.cache.keys().next().value);
    this.cache.set(file, { mtime: info.mtimeMs, size: info.size, value });
    return value;
  }
  async list(provider, workspace, cursor) {
    const cwd = await workspacePath(workspace);
    if (provider === 'codex') {
      const r = await this.codex.call('thread/list', { cwd, limit: 50, cursor: cursor || null, modelProviders: [], sortKey: 'updated_at' });
      const seen = new Set(), sessions = [];
      for (const t of r.data || []) {
        if (seen.has(t.id)) continue;
        let actual; try { actual = await workspacePath(t.cwd); } catch { continue; }
        if (actual !== cwd) continue;
        seen.add(t.id);
        sessions.push({ id: t.id, provider, cwd, title: title(t.name || t.preview) || t.id, updatedAt: time(t.updatedAt), status: t.status?.type || 'unknown' });
      }
      return { sessions, nextCursor: r.nextCursor || null };
    }
    if (provider !== 'claude') throw error('不支持的 Agent');
    const sessions = [];
    for (const file of await this.claudeFiles()) {
      let session; try { session = await this.claudeInfo(file); } catch { continue; }
      if (session?.cwd === cwd) sessions.push({ id: session.id, provider, cwd, title: session.title, updatedAt: session.updatedAt });
    }
    sessions.sort((a, b) => b.updatedAt - a.updatedAt);
    const offset = /^\d+$/.test(String(cursor || '')) ? Number(cursor) : 0;
    return { sessions: sessions.slice(offset, offset + 50), nextCursor: offset + 50 < sessions.length ? String(offset + 50) : null };
  }
  async read(provider, workspace, id) {
    const cwd = await workspacePath(workspace);
    if (!uuid.test(id)) throw error('无效的会话 ID');
    if (provider === 'codex') {
      const { thread: t } = await this.codex.call('thread/read', { threadId: id, includeTurns: true });
      if (await workspacePath(t.cwd) !== cwd) throw error('会话不属于当前 Workspace', 404);
      const messages = [];
      for (const turn of t.turns || []) for (const item of turn.items || []) {
        const role = item.type === 'userMessage' ? 'user' : item.type === 'agentMessage' ? 'assistant' : null;
        if (role) messages.push({ role, text: text(item.text || item.content).slice(0, 16000), at: time(turn.startedAt) });
      }
      const active = t.status?.type === 'active' || t.turns?.at(-1)?.status === 'inProgress';
      const attached = active || await this.attached(provider, id);
      return { id, provider, cwd, title: title(t.name || t.preview) || id, updatedAt: time(t.updatedAt), messages: messages.slice(-100), truncated: messages.length > 100, canResume: !attached, status: attached ? 'attached' : 'saved' };
    }
    if (provider !== 'claude') throw error('不支持的 Agent');
    for (const file of await this.claudeFiles()) {
      if (path.basename(file, '.jsonl') !== id) continue;
      const session = await this.claudeInfo(file);
      if (!session || await workspacePath(session.cwd) !== cwd) continue;
      const attached = await this.attached(provider, id);
      return { ...session, canResume: !attached, status: attached ? 'attached' : 'saved' };
    }
    throw error('找不到该 Workspace 的会话', 404);
  }
}
