import spawn from 'cross-spawn';
import { randomUUID } from 'node:crypto';
import { realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { mkdirSync, writeFileSync, renameSync, readFileSync } from 'node:fs';

const refuse = message => Object.assign(new Error(message), { status: 409, code: 'target_unavailable' });

// One Connector-owned Claude Code process. Drafts never enter stdin before Send.
export class ManagedClaude {
  constructor({ env = process.env, spawnImpl = spawn, stateFile = null } = {}) {
    this.env = env; this.spawn = spawnImpl; this.session = null; this.stateFile = stateFile;
  }
  async start(cwd) {
    if (this.starting || (this.session && !this.session.closed)) throw refuse('已有 Claude Code 会话，请先在电脑停止');
    if (typeof cwd !== 'string' || !path.isAbsolute(cwd)) throw refuse('请输入工作目录的绝对路径');
    this.starting = true;
    try {
    const resolved = await realpath(cwd);
    if (!(await stat(resolved)).isDirectory()) throw refuse('工作目录不存在');
    this.session = { id: randomUUID(), cwd: resolved, title: `Claude Code · ${path.basename(resolved)}`, text: '',
      child: null, running: false, closed: false, output: '', pending: new Map(), error: '' };
    this.checkpoint();
    return this.snapshot();
    } finally { this.starting = false; }
  }
  snapshot() {
    const s = this.session;
    if (!s) return { active: false };
    return { active: !s.closed, id: s.id, cwd: s.cwd, title: s.title, text: s.text, running: s.running,
      output: s.output, error: s.error, recoveryRequired: !!s.recoveryRequired, lastSubmission: s.lastSubmission || '', permissions: [...s.pending].map(([id, request]) => ({ id, tool: request.tool_name, input: request.input })) };
  }
  async restore(snapshot) {
    if (!snapshot || snapshot.running || !/^[a-f0-9-]{36}$/i.test(snapshot.id || '') || typeof snapshot.text !== 'string' || Buffer.byteLength(snapshot.text)>16000) throw refuse('无法恢复旧控制台状态');
    if (this.session && !this.session.closed) throw refuse('已有活动会话，不能覆盖恢复');
    const cwd = await realpath(snapshot.cwd);
    if (!(await stat(cwd)).isDirectory()) throw refuse('恢复目录不存在');
    this.session = { id:snapshot.id,cwd,title:`Claude Code · ${path.basename(cwd)}`,text:snapshot.text,
      child:null,running:false,closed:false,output:String(snapshot.output || '').slice(-100000),pending:new Map(),
      error:'',resume:snapshot.resume !== false };
  }
  checkpoint() {
    if (!this.stateFile || !this.session) return;
    const s = this.session;
    const value = {version:1,...this.snapshot(),resume:!!s.resume || !!s.child,previousPid:s.child?.pid || s.previousPid || null};
    mkdirSync(path.dirname(this.stateFile),{recursive:true,mode:0o700});
    const temp = this.stateFile + '.tmp';
    writeFileSync(temp,JSON.stringify(value),{mode:0o600});
    renameSync(temp,this.stateFile);
  }
  persistBackground() { try { this.checkpoint(); } catch { if(this.session) this.session.error='无法保存恢复状态，请检查电脑磁盘空间和权限'; } }
  async restoreSaved() {
    if (!this.stateFile) return false;
    let saved;
    try { saved=JSON.parse(readFileSync(this.stateFile,'utf8')); } catch(error) { if(error.code==='ENOENT')return false;throw error; }
    if(saved.version!==1 || typeof saved.active!=='boolean') throw refuse('恢复文件格式无效，未覆盖原文件');
    await this.restore({...saved,running:false});
    const s=this.session;
    s.closed=!saved.active; s.previousPid=Number.isSafeInteger(saved.previousPid)&&saved.previousPid>0?saved.previousPid:null;
    s.lastSubmission=typeof saved.lastSubmission==='string'?saved.lastSubmission.slice(0,16000):'';
    s.recoveryRequired=saved.active && (!!saved.running || !!saved.recoveryRequired || !!s.previousPid);
    s.error=s.recoveryRequired?'服务中断，上一轮结果需要在电脑核对；不会自动重发':saved.error || '';
    return true;
  }
  recover(sessionId) {
    const s=this.session;
    if(!s || s.closed || s.id!==sessionId)throw refuse('恢复会话已变化');
    if(s.previousPid) {
      try { process.kill(s.previousPid,0); throw refuse('旧 Claude Code 进程仍在运行，请先在电脑结束旧进程'); }
      catch(error) { if(error.code!=='ESRCH')throw error; }
    }
    s.previousPid=null;s.recoveryRequired=false;s.error='';this.checkpoint();
  }
  log(s, text) { s.output = (s.output + text).slice(-100000); this.persistBackground(); }
  fail(s, message) {
    if (s.closed) return;
    s.closed = true; s.running = false; s.error = message; s.pending.clear();
    s.child?.kill('SIGTERM');
    if (this.session === s) { this.persistBackground(); this.onClosed?.(); }
  }
  launch(s) {
    const child = this.spawn(this.env.PANEL_CLAUDE_BIN || 'claude', [
      '-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose',
      '--permission-prompt-tool', 'stdio', s.resume ? '--resume' : '--session-id', s.id,
    ], { cwd: s.cwd, env: this.env, stdio: ['pipe', 'pipe', 'pipe'] });
    s.child = child;
    child.on('error', () => this.fail(s, '无法启动 Claude Code，请检查安装和登录'));
    child.stdin.on('error', () => this.fail(s, 'Claude Code 输入通道已关闭；请检查电脑结果，勿重复发送'));
    child.on('exit', () => this.fail(s, 'Claude Code 已退出；请检查电脑结果，勿重复发送'));
    let buffer = '';
    child.stdout.on('data', data => {
      buffer += data;
      if (buffer.length > 2 * 1024 * 1024) return this.fail(s, 'Claude Code 响应超过限制');
      let index;
      while ((index = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, index); buffer = buffer.slice(index + 1);
        try { this.receive(s, JSON.parse(line)); } catch { /* Non-protocol output is never a control instruction. */ }
      }
    });
    // stderr can include provider diagnostics; keep a bounded computer-only view.
    child.stderr.on('data', data => this.log(s, String(data)));
    return child;
  }
  receive(s, message) {
    if (s.closed || this.session !== s) return;
    if (message.type === 'assistant') {
      for (const block of message.message?.content || []) {
        if (block.type === 'text') this.log(s, `\nClaude：${block.text}\n`);
        if (block.type === 'tool_use') this.log(s, `\n使用工具：${block.name}\n`);
      }
    } else if (message.type === 'result') {
      s.running = false; s.pending.clear(); s.lastSubmission = ''; this.persistBackground();
      if (message.is_error) s.error = 'Claude Code 本轮失败，请查看电脑输出';
      if (message.is_error && message.result) this.log(s, `\n${message.result}\n`);
    } else if (message.type === 'control_request' && typeof message.request_id === 'string') {
      if (message.request?.subtype === 'can_use_tool') {
        if (s.pending.size >= 32) return this.fail(s, '待处理授权过多');
        s.pending.set(message.request_id, message.request);
      } else {
        s.child.stdin.write(JSON.stringify({ type: 'control_response', response: {
          subtype: 'error', request_id: message.request_id, error: 'Unsupported host request',
        } }) + '\n');
      }
    }
  }
  permission(sessionId, requestId, allow) {
    const s = this.session;
    if (!s || s.id !== sessionId || s.closed || !s.pending.has(requestId)) throw refuse('授权请求已失效');
    const request = s.pending.get(requestId); s.pending.delete(requestId);
    s.child.stdin.write(JSON.stringify({ type: 'control_response', response: { subtype: 'success', request_id: requestId,
      response: allow ? { behavior: 'allow', updatedInput: request.input } : { behavior: 'deny', message: '用户在电脑拒绝本次操作' },
    } }) + '\n');
  }
  stop(sessionId) {
    if (!this.session || this.session.id !== sessionId) throw refuse('会话已变化');
    this.fail(this.session, '已在电脑停止会话');
  }
  close() { const s=this.session;if(!s || s.closed)return;this.persistBackground();s.closed=true;s.pending.clear();s.child?.kill('SIGTERM');this.onClosed?.(); }
  async driver(request) {
    const s = this.session;
    if (!s || s.closed) throw refuse('请先在电脑控制台启动 Claude Code 会话');
    if (request.action === 'inspect') return { title: s.title, fingerprint: s.id, text: s.text };
    if (request.fingerprint !== s.id) throw new Error('目标会话已变化，请重新绑定');
    if (request.expectedText !== s.text) throw new Error('电脑草稿已变化，请重新绑定');
    if (request.action === 'write') { const previous=s.text;s.text=request.text;try {this.checkpoint();}catch(error){s.text=previous;throw error;} return {}; }
    if (request.action !== 'send') throw refuse('不支持的外设指令');
    if (s.recoveryRequired) throw refuse('请先在电脑核对中断前的任务，再恢复会话');
    if (s.running) throw refuse('Claude Code 正在处理上一轮，请稍后发送');
    if (!s.text.trim()) throw refuse('没有可发送的草稿');
    const text = s.text;
    s.running=true;s.error='';s.text='';s.lastSubmission=text;
    try {this.checkpoint();}catch(error){s.text=text;s.running=false;s.lastSubmission='';throw error;}
    // Journal before stdin: an interrupted send is never restored as unsent draft.
    const child = s.child || this.launch(s);
    this.checkpoint();
    await new Promise((resolve, reject) => {
      child.stdin.write(JSON.stringify({ type: 'user', session_id: s.id, message: { role: 'user', content: text }, parent_tool_use_id: null }) + '\n', error => error ? reject(error) : resolve());
    });
    if (s.closed) throw new Error('发送结果未知，请检查电脑');
    this.log(s, `\n你：${text}\n`); s.text = '';
    return { dispatched: true, composerCleared: true };
  }
}
