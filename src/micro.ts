export type MicroKeyId = 'quick' | 'approve' | 'decline' | 'fork' | 'mic' | 'send';
export type MicroActionId = 'fast' | 'approve' | 'decline' | 'fork' | 'voice' | 'execute' | 'stop' | 'new' | 'history' | 'workspace' | 'capture' | 'fullscreen' | 'settings' | 'prompt';
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
