import { readFileSync, writeFileSync, mkdirSync, renameSync } from 'node:fs';
import path from 'node:path';
const labels = {'codex-app':'Codex 桌面','claude-code':'Claude Code','claude-app':'Claude App'};
export class ControllerHub {
  constructor(controllers, target = 'codex-app', stateFile = null) {
    this.controllers = controllers; this.activeTarget = target; this.stateFile = stateFile;
    if (!controllers[target]) throw new Error('目标不可用');
    if (stateFile) {
      try { const saved = JSON.parse(readFileSync(stateFile,'utf8')); if (controllers[saved.target]) this.activeTarget = this.rememberedTarget = saved.target; }
      catch(error) { if (error.code !== 'ENOENT') throw error; }
    }
  }
  remember(target) {
    if (this.stateFile) {
      mkdirSync(path.dirname(this.stateFile),{recursive:true,mode:0o700});
      writeFileSync(this.stateFile+'.tmp',JSON.stringify({target}),{mode:0o600});
      renameSync(this.stateFile+'.tmp',this.stateFile);
    }
    this.rememberedTarget = target;
  }
  get active() { return this.controllers[this.activeTarget]; }
  get provider() { return this.active.provider; }
  get busy() { return !!this.discovering || Object.values(this.controllers).some(c => c.busy); }
  get binding() { return this.active.binding; }
  set binding(value) { this.active.binding = value; }
  forTarget(target) { return this.controllers[target]; }
  status() { return { ...this.active.status(), unified: true, autoBind: true, busy: this.busy }; }
  targets() { return Object.entries(this.controllers).map(([id,c]) => ({id,label:labels[id],selected:id===this.activeTarget,bound:c.status().bound})); }
  select(target) {
    if (!this.controllers[target]) throw Object.assign(new Error('目标不可用'),{status:400});
    if (this.busy) throw Object.assign(new Error('正在处理外设指令，请稍候切换'),{status:409});
    this.remember(target);
    if (target !== this.activeTarget) {
      this.active.binding = null;
      this.activeTarget = target;
      this.active.binding = null;
    }
    return this.status();
  }
  async bind(options) {
    if (this.busy) throw Object.assign(new Error('正在处理外设指令，请稍候'),{status:409});
    if (!options?.auto) return this.active.bind(options);
    this.discovering = true;
    try {
      // Inspect only: discovery must never write drafts, launch sessions or send.
      const results = await Promise.allSettled(Object.entries(this.controllers).map(async ([target,c]) => {
        const state = await c.driver({action:'inspect',title:''});
        if (!state.title || typeof state.text !== 'string' || !state.fingerprint) throw new Error('无法确认会话');
        return {target,foreground:state.foreground === true};
      }));
      const candidates = results.filter(r=>r.status==='fulfilled').map(r=>r.value);
      const foreground = candidates.filter(c=>c.foreground);
      const selected = foreground.length === 1 ? foreground[0] : candidates.find(c=>c.target===this.rememberedTarget) || (candidates.length === 1 ? candidates[0] : null);
      if (!selected) throw Object.assign(new Error(candidates.length ? '检测到多个可用会话，请展开“高级设置”选择一次，再点绑定。' : '未找到可绑定会话。请打开 Codex 或 Claude 会话并检查辅助功能权限；使用 Claude Code 可在高级设置中创建会话。'),{status:409});
      this.discovering = false;
      this.select(selected.target);
      return await this.active.bind({...options,current:true,adoptDraft:true});
    } finally { this.discovering = false; }
  }
  command(body) {
    if (this.discovering) throw Object.assign(new Error('正在识别会话，请稍候'),{status:409});
    if (!body?.bindingId || body.bindingId !== this.active.status().bindingId) throw Object.assign(new Error('目标或绑定已变化，请核对电脑后重新确认本段'),{status:409});
    return this.active.command(body);
  }
}
