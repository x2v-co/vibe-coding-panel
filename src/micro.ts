export type MicroKeyId = 'quick' | 'approve' | 'decline' | 'fork' | 'mic' | 'send';
export type MicroActionId = 'fast' | 'approve' | 'decline' | 'fork' | 'voice' | 'execute' | 'stop' | 'new' | 'history' | 'workspace' | 'capture' | 'fullscreen' | 'settings' | 'prompt' | 'plan' | 'back' | 'forward' | 'sidebar' | 'browser' | 'terminal' | 'review' | 'git' | 'pr' | 'plugins' | 'schedule' | 'reasoning' | 'skill';
export type MicroIconId = 'zap' | 'check' | 'decline' | 'stop' | 'fork' | 'mic' | 'send' | 'codex' | 'history' | 'folder' | 'capture' | 'grid' | 'brain' | 'message';
export type MicroColorId = 'white' | 'mint' | 'blue' | 'amber' | 'pink';
export type MicroKeyConfig = { id: MicroKeyId; label: string; action: MicroActionId; icon: MicroIconId; color: MicroColorId; prompt: string };

// Only the brand mark needs an external asset; other keycaps use Lucide SVGs.
export const microKeycapAssets: Partial<Record<MicroIconId, string>> = {
  codex: '/keycaps/micro/codex.svg',
};

export const defaultMicroKeys: MicroKeyConfig[] = [
  { id: 'quick', label: 'FAST', action: 'fast', icon: 'zap', color: 'white', prompt: '' },
  { id: 'approve', label: 'APPROVE', action: 'approve', icon: 'check', color: 'white', prompt: '' },
  { id: 'decline', label: 'DECLINE', action: 'decline', icon: 'decline', color: 'white', prompt: '' },
  { id: 'fork', label: 'FORK', action: 'fork', icon: 'fork', color: 'white', prompt: '' },
  { id: 'mic', label: 'MIC', action: 'voice', icon: 'mic', color: 'white', prompt: '' },
  { id: 'send', label: 'CODEX', action: 'execute', icon: 'codex', color: 'white', prompt: '' },
];

export const microActions: { id: MicroActionId; label: string }[] = [
  { id: 'plan', label: '切换计划模式（未支持）' },
  { id: 'back', label: '应用历史后退' },
  { id: 'forward', label: '应用历史前进' },
  { id: 'sidebar', label: '显示或隐藏任务侧栏' },
  { id: 'fast', label: 'Fast mode（Bridge 未支持）' },
  { id: 'approve', label: '批准请求（Bridge 未支持）' },
  { id: 'decline', label: '拒绝请求（Bridge 未支持）' },
  { id: 'fork', label: '在新会话中继续（Bridge 未支持）' },
  { id: 'voice', label: '按住说话 / 双击持续录音' },
  { id: 'execute', label: '发送输入区消息' },
  { id: 'stop', label: '停止任务' },
  { id: 'new', label: '新建任务' },
  { id: 'history', label: '任务记录' },
  { id: 'workspace', label: '切换 Workspace' },
  { id: 'capture', label: '添加图片' },
  { id: 'fullscreen', label: '切换全屏' },
  { id: 'settings', label: '打开设置' },
  { id: 'prompt', label: '填入快捷指令（不发送）' },
  ...(['browser','terminal','review','git','pr','plugins','schedule','reasoning','skill'] as const).map((id,i)=>({id,label:['打开浏览器','打开终端','审查更改','Git 操作','Pull Request 操作','打开插件','计划任务','调整推理力度','运行已启用技能'][i]+'（未支持）'})),
];

export const microIconOptions: { id: MicroIconId; label: string }[] = [
  { id: 'zap', label: '快速' }, { id: 'check', label: '批准' }, { id: 'decline', label: '拒绝' },
  { id: 'fork', label: '分叉' }, { id: 'mic', label: '语音' }, { id: 'codex', label: 'Codex' },
  { id: 'send', label: '发送' }, { id: 'stop', label: '停止' }, { id: 'history', label: '历史' },
  { id: 'folder', label: '目录' }, { id: 'capture', label: '图片' }, { id: 'grid', label: '面板' },
  { id: 'brain', label: 'Agent' }, { id: 'message', label: '指令' },
];

export const microColors: { id: MicroColorId; label: string }[] = [
  { id: 'white', label: '白' }, { id: 'mint', label: '薄荷' }, { id: 'blue', label: '蓝' },
  { id: 'amber', label: '琥珀' }, { id: 'pink', label: '粉' },
];

export function unavailableMicroAction(action: MicroActionId): string | undefined {
  const names: Partial<Record<MicroActionId, string>> = {
    plan:'原生计划模式', browser:'打开桌面浏览器', terminal:'打开桌面终端', review:'审查更改', git:'Git 操作', pr:'Pull Request 操作', plugins:'插件', schedule:'计划任务', reasoning:'推理力度调整', skill:'已启用技能',
    fast: '原生 Fast mode', approve: '批准请求', decline: '拒绝请求', fork: '保留上下文分叉会话',
  };
  return names[action] ? `当前 Bridge 尚未支持${names[action]}` : undefined;
}

export function readMicroConfiguration(saved: unknown, version: string | null): MicroKeyConfig[] {
  return defaultMicroKeys.map((fallback) => {
    const item = Array.isArray(saved) ? saved.find((key) => key?.id === fallback.id) : undefined;
    if (!item || typeof item !== 'object') return { ...fallback };
    // Repair only the old shipped defaults, preserving explicitly customized bindings.
    const legacyDefault = version !== '2' && (
      (item.id === 'approve' && item.action === 'execute') ||
      (item.id === 'decline' && item.action === 'stop') ||
      (item.id === 'fork' && item.action === 'new')
    );
    return {
      id: fallback.id,
      action: !legacyDefault && microActions.some(({ id }) => id === item.action) ? item.action : fallback.action,
      label: typeof item.label === 'string' ? (item.id === 'fork' && legacyDefault && item.label === 'NEW' ? 'FORK' : item.label.slice(0, 12)) : fallback.label,
      icon: microIconOptions.some(({ id }) => id === item.icon) ? (item.id === 'decline' && legacyDefault && item.icon === 'stop' ? 'decline' : item.icon) : fallback.icon,
      color: microColors.some(({ id }) => id === item.color) ? item.color : fallback.color,
      prompt: typeof item.prompt === 'string' ? item.prompt.slice(0, 1000) : '',
    };
  });
}

export function updateMicroConfiguration(keys: MicroKeyConfig[], id: MicroKeyId, patch: Partial<MicroKeyConfig>) {
  const previous = keys.find((key) => key.id === id);
  return keys.map((key) => {
    if (key.id === id) return { ...key, ...patch, id };
    // Moving a keycap swaps its visual identity, never its action or physical slot.
    if (previous && patch.icon && patch.icon !== previous.icon && key.icon === patch.icon) return { ...key, icon: previous.icon };
    return key;
  });
}

export class MicroVoiceGesture {
  downAt: number | null = null;
  lastTapAt: number | null = null;
  latched = false;
  suppressRelease = false;

  press(now: number): 'start' | 'stop' | 'latch' | 'none' {
    if (this.downAt !== null) return 'none';
    this.downAt = now;
    if (this.latched) { this.latched = false; this.suppressRelease = true; this.lastTapAt = null; return 'stop'; }
    if (this.lastTapAt !== null && now - this.lastTapAt <= 350) { this.latched = true; this.lastTapAt = null; return 'latch'; }
    return 'start';
  }

  release(now: number): 'stop' | 'defer' | 'none' {
    if (this.downAt === null) return 'none';
    const held = now - this.downAt;
    const pressedAt = this.downAt;
    this.downAt = null;
    if (this.suppressRelease) { this.suppressRelease = false; return 'none'; }
    if (this.latched) return 'none';
    if (held >= 350) { this.lastTapAt = null; return 'stop'; }
    this.lastTapAt = pressedAt;
    return 'defer';
  }

  reset() { this.downAt = null; this.lastTapAt = null; this.latched = false; this.suppressRelease = false; }
}

export type MicroDirection = 'up' | 'right' | 'down' | 'left';
export type MicroBinding = { action: MicroActionId; prompt: string };
export type MicroPreferences = {
  agentMode: 'recent' | 'priority' | 'pinned' | 'custom';
  assignments: string[];
  pinned: string[];
  joystick: Record<MicroDirection, MicroBinding>;
  knobMode: 'composer' | 'scroll' | 'custom';
  knob: Record<'left' | 'right' | 'press' | 'hold', MicroBinding>;
};
export const microDirections: { id: MicroDirection; label: string }[] = [
  { id: 'up', label: '上' }, { id: 'right', label: '右' }, { id: 'down', label: '下' }, { id: 'left', label: '左' },
];
export const defaultMicroJoystick: MicroPreferences['joystick'] = {
  up: { action: 'plan', prompt: '' }, right: { action: 'forward', prompt: '' },
  down: { action: 'sidebar', prompt: '' }, left: { action: 'back', prompt: '' },
};
export function readMicroPreferences(value: unknown): MicroPreferences {
  const v = value && typeof value === 'object' ? value as Partial<MicroPreferences> : {};
  const binding = (value: MicroBinding | undefined, fallback: MicroBinding): MicroBinding => ({
    action: microActions.some(a => a.id === value?.action) ? value!.action : fallback.action,
    prompt: typeof value?.prompt === 'string' ? value.prompt.slice(0, 1000) : '',
  });
  return {
    agentMode: ['recent', 'priority', 'pinned', 'custom'].includes(v.agentMode || '') ? v.agentMode! : 'recent',
    assignments: Array.from({length:6}, (_,i) => typeof v.assignments?.[i] === 'string' ? v.assignments[i] : ''),
    pinned: Array.isArray(v.pinned) ? [...new Set(v.pinned.filter(id => typeof id === 'string'))].slice(0,6) : [],
    joystick: Object.fromEntries(microDirections.map(({id}) => [id,binding(v.joystick?.[id], defaultMicroJoystick[id])])) as MicroPreferences['joystick'],
    knobMode: ['composer','scroll','custom'].includes(v.knobMode || '') ? v.knobMode! : 'composer',
    knob: {
      left: binding(v.knob?.left, {action:'back',prompt:''}), right: binding(v.knob?.right,{action:'forward',prompt:''}),
      press: binding(v.knob?.press,{action:'history',prompt:''}), hold: binding(v.knob?.hold,{action:'settings',prompt:''}),
    },
  };
}
export const microStatusLegend = [
  {id:'idle',color:'白色',label:'空闲',description:'没有正在执行的任务；完成消息已读或任务已停止。'},
  {id:'running',color:'蓝色',label:'思考中',description:'任务正在排队或执行。'},
  {id:'completed',color:'绿色',label:'完成 · 未读',description:'任务已完成，还有未读更新。'},
  {id:'waiting',color:'琥珀色',label:'需要输入',description:'等待审批或回复；当前 Connector 尚不提供此状态。'},
  {id:'failed',color:'红色',label:'错误',description:'任务失败。旋钮旁的红色取消键另表示可取消当前选择。'},
  {id:'empty',color:'熄灭',label:'未分配',description:'没有跟踪任务；按下可新建任务。'},
];
type MicroTask = {id:string;status:string;createdAt:number;startedAt?:number|null;finishedAt?:number|null;revision?:number;events?:{at:number}[]};
export function microTaskTime(task: MicroTask) { return Math.max(task.createdAt,task.startedAt || 0,task.finishedAt || 0,...(task.events || []).map(e=>e.at)); }
export function microTaskVersion(task: MicroTask) { return `${task.status}:${task.revision ?? microTaskTime(task)}`; }
export function microTaskState(task: MicroTask | undefined, read: Record<string,string>) {
  if (!task) return 'empty';
  if (task.status==='completed') return read[task.id] === microTaskVersion(task) ? 'idle' : 'completed';
  if (task.status==='stopped') return 'idle';
  return task.status;
}
export function microSlots<T extends MicroTask>(tasks:T[], prefs:MicroPreferences, read:Record<string,string>):(T|undefined)[] {
  if(prefs.agentMode==='custom') return prefs.assignments.map(id=>tasks.find(t=>t.id===id));
  if(prefs.agentMode==='pinned') return prefs.pinned.map(id=>tasks.find(t=>t.id===id));
  const priority=(t:T)=>microTaskState(t,read)==='completed'?0:['running','queued'].includes(t.status)?1:2;
  return [...tasks].sort((a,b)=>(prefs.agentMode==='priority'?priority(a)-priority(b):0)||microTaskTime(b)-microTaskTime(a)||a.id.localeCompare(b.id)).slice(0,6);
}
// A drag activates once after leaving the center dead zone; release rearms it.
export function microDragDirection(x:number,y:number,threshold=18):MicroDirection|null {
  if(Math.hypot(x,y)<threshold)return null;
  return Math.abs(x)>Math.abs(y)?x>0?'right':'left':y>0?'down':'up';
}
