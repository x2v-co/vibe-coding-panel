import express from 'express';
import QRCode from 'qrcode';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { isLoopbackRequest } from './pairing.js';

const source = fileURLToPath(new URL('../scripts/desktop-controller.swift', import.meta.url));
const page = fileURLToPath(new URL('../public/controller.html', import.meta.url));
const problem = (message, status = 409) => Object.assign(new Error(message), { status });

export function nativeDesktopDriver(request, { target = 'codex-app' } = {}) {
  return new Promise((resolve, reject) => {
    const binary = process.env.PANEL_DESKTOP_BINARY || '/usr/bin/swift';
    const nativeSource = target === 'claude-app' ? fileURLToPath(new URL('../scripts/claude-desktop-controller.swift', import.meta.url)) : source;
    const child = spawn(binary, process.env.PANEL_DESKTOP_BINARY ? [] : [nativeSource], { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '', settled = false;
    const finish = (error, value) => {
      if (settled) return; settled = true; clearTimeout(timer);
      if (error) reject(error); else resolve(value);
    };
    const timer = setTimeout(() => { child.kill('SIGKILL'); finish(problem('电脑控制超时；请检查电脑后重新绑定')); }, 15000);
    child.stdout.on('data', data => { stdout += data; if (stdout.length > 100000) { child.kill(); finish(problem('电脑控制响应异常')); } });
    child.stderr.resume();
    child.on('error', () => finish(problem('无法启动桌面控制程序', 503)));
    child.stdin.on('error', () => {});
    child.on('close', code => {
      try { const value = JSON.parse(stdout); finish(code === 0 ? null : Object.assign(problem(value.error || '桌面控制失败'), { code: value.code }), value); }
      catch { finish(problem('电脑控制程序不可用，请检查 Swift 和辅助功能权限', 503)); }
    });
    child.stdin.end(JSON.stringify(request));
  });
}

export class DesktopController {
  constructor({ title, driver, provider = 'codex', target = 'codex-app' }) { this.title = title; this.driver = driver || (request => nativeDesktopDriver(request, { target })); this.provider = provider; this.target = target; this.binding = null; this.busy = false; this.receipts = new Map(); }
  status() { return { enabled: true, provider: this.provider, target: this.target, title: this.title, bound: Boolean(this.binding), bindingId: this.binding?.id ?? null, revision: this.binding?.revision ?? 0, hasDraft: Boolean(this.binding?.text.trim()), busy: this.busy }; }
  async exclusive(operation) {
    if (this.busy) throw problem('正在处理上一条指令');
    this.busy = true;
    try { return await operation(); } finally { this.busy = false; }
  }
  async bind({ adoptDraft = false, current = false } = {}) {
    return this.exclusive(async () => {
      this.binding = null;
      const state = await this.driver({ action: 'inspect', title: current ? '' : this.title });
      if (current && (typeof state.title !== 'string' || !state.title.trim())) throw problem('无法确认当前会话标题');
      if (state.text !== '' && !adoptDraft) throw problem('请先清空电脑测试会话输入框，再绑定');
      this.title = state.title || this.title;
      this.binding = { id: randomUUID(), fingerprint: state.fingerprint, text: state.text, revision: 0 };
      return { ...this.status(), busy: false };
    });
  }
  async command(body) {
    const { bindingId, eventId, revision, action, text } = body || {};
    if (!['write', 'append', 'send'].includes(action) || typeof eventId !== 'string' || !/^[a-zA-Z0-9-]{8,80}$/.test(eventId) ||
        !Number.isSafeInteger(revision) || revision < 0 || (action !== 'send' && (typeof text !== 'string' || Buffer.byteLength(text) > 16000))) throw problem('指令格式无效', 400);
    const key = `${bindingId}:${eventId}`, signature = JSON.stringify([action, revision, text]);
    const receipt = this.receipts.get(key);
    if (receipt) {
      if (receipt.signature !== signature) throw problem('事件编号已被其他指令使用');
      if (receipt.error) throw problem(receipt.error);
      return receipt.result;
    }
    return this.exclusive(async () => {
      const binding = this.binding;
      if (!binding || binding.id !== bindingId || binding.revision !== revision) throw problem('绑定或草稿版本已失效，请在电脑重新绑定');
      const nextText = action === 'append' ? binding.text + (binding.text && !/\s$/.test(binding.text) ? '\n' : '') + text : text;
      if (action === 'append' && (!text.trim() || Buffer.byteLength(nextText) > 16000)) throw problem('追加内容为空或完整草稿超过长度限制', 400);
      if (action === 'send' && !binding.text.trim()) throw problem('没有可发送的草稿');
      // Record before dispatch. Uncertain outcomes must never cause a Send retry.
      const record = { signature, error: '执行结果未知，请检查电脑，不要重复发送' };
      this.receipts.set(key, record);
      while (this.receipts.size > 128) this.receipts.delete(this.receipts.keys().next().value);
      try {
        const result = await this.driver({ action: action === 'append' ? 'write' : action, title: this.title, fingerprint: binding.fingerprint, expectedText: binding.text, ...(action !== 'send' ? { text: nextText } : {}) });
        if (action !== 'send') { binding.text = nextText; binding.revision++; }
        else if (result.composerCleared === true) { binding.text = ''; binding.revision++; }
        else this.binding = null; // Uncertain submission: require explicit recovery, never replay Send.
        record.result = { ...this.status(), busy: false, dispatched: result.dispatched === true };
        delete record.error;
        return record.result;
      } catch (error) {
        // Only an explicit pre-mutation native refusal is safe to resume.
        // Timeouts, failed readback and any uncertain dispatch still revoke.
        if (error.code !== 'target_unavailable') this.binding = null;
        record.error = error.message; throw error;
      }
    });
  }
}

export function desktopControllerRouter({ controller, authenticate, liveSpeech = null, managed = null, connectionInfo = null, correctTranscript = async text => text }) {
  const router = express.Router();
  router.get('/view', (_req, res) => { res.set('Cache-Control', 'no-store'); res.sendFile(page); });
  router.get('/controller.css', (_req,res) => {res.set('Cache-Control','no-store');res.sendFile(fileURLToPath(new URL('../public/controller.css',import.meta.url)));});
  router.get('/live-capture.js', (_req, res) => { res.set('Cache-Control', 'no-store'); res.sendFile(fileURLToPath(new URL('../public/live-capture.js', import.meta.url))); });
  for (const asset of ['controller-bootstrap.js', 'relay-transport.js']) {
    router.get('/' + asset, (_req, res) => { res.set('Cache-Control', 'no-store'); res.sendFile(fileURLToPath(new URL('../public/' + asset, import.meta.url))); });
  }
  router.use(async (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    if (req.method !== 'GET' && !req.is('application/json')) return res.status(415).json({ error: '需要 JSON 请求' });
    try {
      if (!isLoopbackRequest(req) && !await authenticate(req)) return res.status(401).json({ error: '请先在主面板完成手机配对' });
      next();
    } catch { res.status(401).json({ error: '无法验证手机配对' }); }
  });
  router.get('/status', (req, res) => res.json({ ...controller.status(), local: isLoopbackRequest(req) }));
  router.get('/connection', async(req,res) => {
    if (!isLoopbackRequest(req)) return res.status(403).json({error:'请在电脑查看连接入口'});
    try {
      if (!connectionInfo) throw new Error();
      const links = await connectionInfo();
      const options = {width:256,margin:4,errorCorrectionLevel:'M'};
      const [entryQr,controllerQr] = await Promise.all([QRCode.toDataURL(links.entry,options),QRCode.toDataURL(links.controller,options)]);
      res.json({...links,entryQr,controllerQr});
    }
    catch {res.status(503).json({error:'连接入口正在准备，请稍后刷新'});}
  });
  router.get('/targets', (req,res) => {
    if (!isLoopbackRequest(req)) return res.status(403).json({error:'请在电脑选择目标'});
    res.json(controller.targets?.() || [{id:controller.target,label:controller.target,selected:true}]);
  });
  router.post('/target', (req,res) => {
    if (!isLoopbackRequest(req)) return res.status(403).json({error:'请在电脑选择目标'});
    if (!controller.select) return res.status(409).json({error:'请使用统一控制中心'});
    try { res.json({...controller.select(req.body?.target),local:true}); }
    catch(error) {res.status(error.status || 400).json({error:error.message});}
  });
  const managedController = controller.forTarget?.('claude-code') || controller;
  router.use('/managed', (req, res, next) => {
    if (!isLoopbackRequest(req)) return res.status(403).json({ error: 'Claude Code 控制台仅限电脑使用' });
    if (!managed) return res.status(404).json({ error: '当前外设不是 Claude Code 模式' });
    next();
  });
  router.get('/managed/view', (_req, res) => res.sendFile(fileURLToPath(new URL('../public/claude-console.html', import.meta.url))));
  router.get('/managed/state', (_req, res) => res.json({ ...managed.snapshot(), controller: managedController.status() }));
  router.post('/managed/start', async (req, res) => {
    try {
      if (controller.busy) return res.status(409).json({ error: '正在处理外设指令，请稍候' });
      if (controller.status().target !== 'claude-code') return res.status(409).json({error:'请先在控制中心选择 Claude Code'});
      await managed.start(req.body?.cwd);
      res.json(await managedController.bind({ adoptDraft: true, current: true }));
    } catch (error) { res.status(error.status || 400).json({ error: error.message }); }
  });
  router.post('/managed/recover', async(req,res) => {
    try { if(controller.busy || controller.status().target!=='claude-code') throw problem('请先选择 Claude Code 并等待当前操作完成'); managed.recover(req.body?.sessionId); res.json(await managedController.bind({adoptDraft:true,current:true})); } catch(error) {res.status(error.status || 500).json({error:error.message});}
  });
  router.post('/managed/stop', (req, res) => {
    try { managed.stop(req.body?.sessionId); managedController.binding = null; res.json({ ok: true }); }
    catch (error) { res.status(error.status || 400).json({ error: error.message }); }
  });
  router.post('/managed/permission', (req, res) => {
    try {
      if (typeof req.body?.allow !== 'boolean') return res.status(400).json({ error: '请选择允许或拒绝' });
      managed.permission(req.body.sessionId, req.body.requestId, req.body.allow); res.json({ ok: true });
    } catch (error) { res.status(error.status || 400).json({ error: error.message }); }
  });
  router.get('/speech/status', (_req, res) => res.json(liveSpeech ? { enabled: true, ...liveSpeech.status() } : { enabled: false, ready: false }));
  router.post('/speech', async (req, res) => {
    if (!liveSpeech) return res.status(503).json({ error: '此电脑未开启增量语音，可取消勾选后使用普通录音' });
    const expected = req.body?.bindingId;
    if (!expected || expected !== controller.status().bindingId) return res.status(409).json({ error: '语音绑定已失效，请确认电脑会话' });
    try {
      const started = Date.now();
      const result = { ...await liveSpeech.transcribe(req.body?.pcm) };
      // Only the final snapshot uses the shared ordinary-recording corrector.
      // Keep uncertain transcripts as review candidates even after correction.
      if (req.body?.final === true) {
        const field = result.candidateText?.trim() ? 'candidateText' : 'text';
        const original = result[field];
        if (original?.trim()) {
          try { result[field] = await correctTranscript(original, { provider: controller.provider, timeoutMs: Math.max(0, 50000 - (Date.now() - started)) }); }
          catch { result[field] = original; }
        }
      }
      if (expected !== controller.status().bindingId) return res.status(409).json({ error: '识别期间绑定已变化，未写入草稿' });
      res.json(result);
    } catch (e) { res.status(e.status || 503).json({ error: e.message }); }
  });
  router.post('/bind', async (req, res) => {
    if (!isLoopbackRequest(req)) return res.status(403).json({ error: '请在电脑上绑定会话' });
    try { await controller.bind({ adoptDraft: req.body?.adoptDraft === true, current: req.body?.current === true, auto: req.body?.auto === true }); res.json(controller.status()); } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
  });
  router.post('/command', async (req, res) => {
    try { res.json(await controller.command(req.body)); } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
  });
  return router;
}
