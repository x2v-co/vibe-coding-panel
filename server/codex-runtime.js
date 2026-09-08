import { createInterface } from 'node:readline';
import spawn from 'cross-spawn';

// A small long lived JSON-RPC client for Codex app-server. Notifications are
// deliberately kept separate from request responses so turn progress can be
// forwarded to every connected Panel client.
export class CodexRuntime {
  constructor(env = process.env) { this.env = env; this.pending = new Map(); this.listeners = new Map(); this.seq = 0; }
  async start() {
    if (this.child) return;
    this.child = spawn(this.env.PANEL_CODEX_BIN || 'codex', ['app-server'], { env: this.env, stdio: ['pipe', 'pipe', 'ignore'] });
    this.lines = createInterface({ input: this.child.stdout });
    this.lines.on('line', (line) => this.receive(line));
    await this.request('initialize', { clientInfo: { name: 'vibe_panel_runtime', version: '0.1.0' } });
    this.child.stdin.write('{"method":"initialized","params":{}}\n');
  }
  receive(line) { let message; try { message = JSON.parse(line); } catch { return; }
    if (message.id != null && this.pending.has(message.id)) { const p = this.pending.get(message.id); this.pending.delete(message.id); return message.error ? p.reject(new Error(message.error.message || 'Codex app-server error')) : p.resolve(message.result); }
    const threadId = message.params?.threadId || message.params?.thread?.id;
    const targets = threadId ? (this.listeners.get(threadId) || []) : [...this.listeners.values()].flatMap((set) => [...set]);
    for (const fn of targets) fn(message);
  }
  request(method, params) { return new Promise((resolve, reject) => { const id = ++this.seq; const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`Codex request timeout: ${method}`)); }, 30000); this.pending.set(id, { resolve: (v) => { clearTimeout(timer); resolve(v); }, reject: (e) => { clearTimeout(timer); reject(e); } }); this.child.stdin.write(`${JSON.stringify({ id, method, params })}\n`); }); }
  async turn(threadId, cwd, prompt) {
    await this.start();
    try {
      await this.request('thread/resume', { threadId, cwd });
    } catch (error) {
      // Sessions created by an unavailable desktop-only provider can still be
      // resumed with the standard OpenAI provider when the CLI is authenticated.
      if (!/model provider .* not found/i.test(error.message)) throw error;
      await this.request('thread/resume', { threadId, cwd, modelProvider: this.env.PANEL_CODEX_MODEL_PROVIDER || 'openai' });
    }
    return this.request('turn/start', { threadId, input: [{ type: 'text', text: prompt }], cwd });
  }
  subscribe(threadId, fn) { const set = this.listeners.get(threadId) || new Set(); set.add(fn); this.listeners.set(threadId, set); return () => { set.delete(fn); if (!set.size) this.listeners.delete(threadId); }; }
  close() { this.lines?.close(); this.child?.kill('SIGTERM'); this.child = null; }
}
