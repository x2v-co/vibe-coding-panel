import {
  ArrowUp, ArrowDown, ArrowLeft, ArrowRight, BrainCircuit, Camera, Check, ChevronRight, CircleCheck, CircleX, CircleStop, Clock3, Copy, Folder, FolderOpen, Grid2X2, History, Split,
  FileAudio, FlaskConical, ImagePlus, Keyboard, Laptop, Link2, Maximize2, Mic, MicOff, Minimize2,
  MessageCircle, Palette, Play, Plus, RotateCcw, RotateCw, Send, Server, ShieldCheck,
  Smartphone, Sparkles, Terminal, Trash2, Wifi, X, Zap,
} from 'lucide-react';
import QRCode from 'qrcode';
import { MIN_RECORDING_MS, recordingMimeTypes, validateRecording } from './recording';
import { ChangeEvent, FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { defaultMicroKeys, microActions, microColors, microIconOptions, microKeycapAssets, readMicroConfiguration, updateMicroConfiguration, unavailableMicroAction, MicroVoiceGesture } from './micro';
import type { MicroKeyId, MicroActionId, MicroIconId, MicroKeyConfig } from './micro';

type JobStatus = 'idle' | 'queued' | 'running' | 'completed' | 'failed' | 'stopped';
type ThemeId = 'signal' | 'smoke' | 'ice' | 'midnight';
type LayoutId = 'console' | 'bar' | 'matrix' | 'hardware-tri' | 'hardware-vibebar' | 'hardware-five' | 'hardware-aha' | 'hardware-micro';
type ConnectionMode = 'demo' | 'local' | 'remote';
type ConnectionState = 'online' | 'checking' | 'offline' | 'unknown';
type AgentProviderId = 'codex' | 'claude';
type AgentConnection = { mode: ConnectionMode; url: string; token: string };
type AgentProviderInfo = { id: AgentProviderId; label: string; available: boolean; authenticated: boolean; version?: string };
type Activity = { id: number; revision?: number; at: number; type: string; text?: string; status?: string };
type SavedJob = {
  id: string; prompt: string; cwd: string; status: JobStatus; result?: string;
  agentProvider?: AgentProviderId;
  revision?: number;
  createdAt: number; startedAt?: number | null; finishedAt?: number | null; events?: Activity[];
};
type WorkspaceDirectory = { name: string; path: string };
type PairedDevice = { id: string; name: string; userAgent: string; createdAt: number; lastSeenAt: number };
type PairingInfo = { code: string; expiresAt: number; pairingUrl: string };
type NativeSession = { id: string; provider: AgentProviderId; cwd: string; title: string; updatedAt: number; status?: string; canResume?: boolean; truncated?: boolean; messages?: { role: string; text: string; at: number }[] };

const ACTIVE_JOB_KEY = 'vibe-panel-active-job-id';
const MICRO_KEYS_VERSION = '2';
const agentOptions: { id: AgentProviderId; label: string; description: string }[] = [
  { id: 'codex', label: 'Codex', description: 'OpenAI Codex CLI' },
  { id: 'claude', label: 'Claude Code', description: 'Anthropic Claude Code' },
];

const statusLabels: Record<JobStatus, string> = {
  idle: '待命', queued: '连接中', running: '执行中', completed: '完成', failed: '异常', stopped: '已停止',
};

const themes: { id: ThemeId; label: string; description: string }[] = [
  { id: 'signal', label: '银橙', description: '银色外壳，信号橙主键' },
  { id: 'smoke', label: '烟黑', description: '深灰外壳，薄荷绿主键' },
  { id: 'ice', label: '冰白', description: '冷白外壳，冰蓝主键' },
  { id: 'midnight', label: '午夜', description: '深蓝外壳，珊瑚红主键' },
];

const layouts: { id: LayoutId; label: string; description: string; previewKeys: number }[] = [
  { id: 'console', label: 'Console', description: '大屏幕与强化语音主键', previewKeys: 4 },
  { id: 'bar', label: 'VibeBar', description: '横向等宽机械键布局', previewKeys: 4 },
  { id: 'matrix', label: 'Macro Pad', description: '紧凑方形双排键布局', previewKeys: 4 },
  { id: 'hardware-tri', label: 'TriKey', description: '参考图一：暂停、捕获、语音批准三键布局', previewKeys: 3 },
  { id: 'hardware-vibebar', label: 'VibeBar 6', description: '参考图二：左侧双键与底部四键布局', previewKeys: 6 },
  { id: 'hardware-five', label: 'Voice Five', description: '参考图三：横向五键布局', previewKeys: 5 },
  { id: 'hardware-aha', label: 'AhaKey 4', description: '参考图四：横向四键布局', previewKeys: 4 },
  { id: 'hardware-micro', label: 'Codex Micro', description: '六个任务状态键与可自定义 Command Keys', previewKeys: 10 },
];

function readTheme(): ThemeId {
  const saved = localStorage.getItem('vibe-panel-theme');
  return themes.some((item) => item.id === saved) ? saved as ThemeId : 'signal';
}

function readLayout(): LayoutId {
  const saved = localStorage.getItem('vibe-panel-layout');
  return layouts.some((item) => item.id === saved) ? saved as LayoutId : 'console';
}

function readConnection(): AgentConnection {
  try {
    const saved = JSON.parse(localStorage.getItem('vibe-panel-connection') || '{}');
    return {
      mode: saved.mode === 'remote' ? 'remote' : saved.mode === 'demo' ? 'demo' : 'local',
      url: typeof saved.url === 'string' ? saved.url : '',
      token: sessionStorage.getItem('vibe-panel-remote-token') || '',
    };
  } catch {
    return { mode: 'local', url: '', token: '' };
  }
}

function readHistory(): SavedJob[] {
  try { return JSON.parse(localStorage.getItem('vibe-panel-history') || '[]'); } catch { return []; }
}

function readAgentProvider(): AgentProviderId {
  return localStorage.getItem('vibe-panel-agent-provider') === 'claude' ? 'claude' : 'codex';
}

function readMicroKeys(): MicroKeyConfig[] {
  try {
    return readMicroConfiguration(JSON.parse(localStorage.getItem('vibe-panel-micro-keys') || '[]'), localStorage.getItem('vibe-panel-micro-keys-version'));
  } catch {
    return defaultMicroKeys;
  }
}

function renderMicroIcon(icon: MicroIconId, size = 22) {
  const asset = microKeycapAssets[icon];
  if (asset) return <i className="micro-keycap-glyph" data-keycap={icon} aria-hidden="true" style={{ width: size, height: size, maskImage: `url(${asset})`, WebkitMaskImage: `url(${asset})` }} />;
  const props = { size, strokeWidth: 1.8, className: 'micro-keycap-glyph', 'aria-hidden': true as const };
  if (icon === 'check') return <CircleCheck {...props} />;
  if (icon === 'decline') return <CircleX {...props} />;
  if (icon === 'fork') return <Split {...props} style={{ transform: 'rotate(90deg)' }} />;
  if (icon === 'mic') return <Mic {...props} />;
  if (icon === 'stop') return <CircleStop {...props} />;
  if (icon === 'send') return <Send {...props} />;
  if (icon === 'history') return <History {...props} />;
  if (icon === 'folder') return <Folder {...props} />;
  if (icon === 'capture') return <ImagePlus {...props} />;
  if (icon === 'grid') return <Grid2X2 {...props} />;
  if (icon === 'brain') return <BrainCircuit {...props} />;
  if (icon === 'message') return <MessageCircle {...props} />;
  return <Zap {...props} />;
}

function audioDataUrl(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('无法读取录音'));
    reader.readAsDataURL(blob);
  });
}

function imageDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const source = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      const scale = Math.min(1, 1920 / Math.max(image.naturalWidth, image.naturalHeight));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
      canvas.getContext('2d')?.drawImage(image, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(source);
      resolve(canvas.toDataURL('image/jpeg', 0.86));
    };
    image.onerror = () => { URL.revokeObjectURL(source); reject(new Error('无法读取所选图片')); };
    image.src = source;
  });
}

function PanelApp() {
  const [prompt, setPrompt] = useState('');
  const [taskTitle, setTaskTitle] = useState('');
  const [cwd, setCwd] = useState(localStorage.getItem('vibe-panel-cwd') || '.');
  const [jobId, setJobId] = useState<string | null>(null);
  const [streamVersion, setStreamVersion] = useState(0);
  const [status, setStatus] = useState<JobStatus>('idle');
  const [activity, setActivity] = useState<Activity[]>([]);
  const [result, setResult] = useState('');
  const [error, setError] = useState('');
  const [isListening, setIsListening] = useState(false);
  const [isPreparingVoice, setIsPreparingVoice] = useState(false);
  const [isFinalizingVoice, setIsFinalizingVoice] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [canImportRecording, setCanImportRecording] = useState(false);
  const [isCapturing, setIsCapturing] = useState(false);
  const [capturePath, setCapturePath] = useState('');
  const [capturePreview, setCapturePreview] = useState('');
  const [isAddingContext, setIsAddingContext] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(() => localStorage.getItem('vibe-panel-onboarding-dismissed') !== '1');
  const [showHistory, setShowHistory] = useState(false);
  const [nativeList, setNativeList] = useState<NativeSession[]>([]);
  const [nativeSelection, setNativeSelection] = useState<NativeSession | null>(null);
  const [nativeError, setNativeError] = useState('');
  const [nativeLoading, setNativeLoading] = useState(false);
  const [nativeCursor, setNativeCursor] = useState<string | null>(null);
  const [historySource, setHistorySource] = useState<'native' | 'panel'>('native');
  const [terminalReleased, setTerminalReleased] = useState(false);
  const [showWorkspacePicker, setShowWorkspacePicker] = useState(false);
  const [workspacePath, setWorkspacePath] = useState('');
  const [workspaceResolvedPath, setWorkspaceResolvedPath] = useState('');
  const [workspaceParent, setWorkspaceParent] = useState<string | null>(null);
  const [workspaceDirectories, setWorkspaceDirectories] = useState<WorkspaceDirectory[]>([]);
  const [workspaceLoading, setWorkspaceLoading] = useState(false);
  const [workspaceError, setWorkspaceError] = useState('');
  const [theme, setTheme] = useState<ThemeId>(readTheme);
  const [layout, setLayout] = useState<LayoutId>(readLayout);
  const [connection, setConnection] = useState<AgentConnection>(readConnection);
  const [connectionState, setConnectionState] = useState<ConnectionState>(() => readConnection().mode === 'local' ? 'online' : 'unknown');
  const [agentLabel, setAgentLabel] = useState('LOCAL AGENT');
  const [agentProvider, setAgentProvider] = useState<AgentProviderId>(readAgentProvider);
  const [providers, setProviders] = useState<AgentProviderInfo[]>([]);
  const [microKeys, setMicroKeys] = useState<MicroKeyConfig[]>(readMicroKeys);
  const [editingMicroKey, setEditingMicroKey] = useState<MicroKeyId | null>(null);
  const [knobIndex, setKnobIndex] = useState<number | null>(null);
  const [microNavigation, setMicroNavigation] = useState<string[]>([]);
  const [microNavigationIndex, setMicroNavigationIndex] = useState(-1);
  const [history, setHistory] = useState<SavedJob[]>(() => readConnection().mode === 'demo' ? readHistory() : []);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [copied, setCopied] = useState(false);
  const [isPanelMode, setIsPanelMode] = useState(false);
  const [authReady, setAuthReady] = useState(false);
  const [pairCode, setPairCode] = useState('');
  const [pairingInfo, setPairingInfo] = useState<PairingInfo | null>(null);
  const [pairingQr, setPairingQr] = useState('');
  const [pairingBusy, setPairingBusy] = useState(false);
  const [pairingAdmin, setPairingAdmin] = useState(false);
  const [publicUrl, setPublicUrl] = useState(localStorage.getItem('vibe-panel-public-url') || window.location.origin);
  const [devices, setDevices] = useState<PairedDevice[]>([]);
  const [pairedDevice, setPairedDevice] = useState<PairedDevice | null>(null);
  const [isRecoveringJob, setIsRecoveringJob] = useState(() => Boolean(localStorage.getItem(ACTIVE_JOB_KEY)));
  const promptRef = useRef<HTMLTextAreaElement | null>(null);
  const latestPromptRef = useRef('');
  const speechBaseRef = useRef('');
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const microphoneStreamRef = useRef<MediaStream | null>(null);
  const voiceFinalizingRef = useRef(false);
  const shouldTranscribeRef = useRef(false);
  const voiceSessionRef = useRef(0);
  const voiceStartPendingRef = useRef(false);
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const audioInputRef = useRef<HTMLInputElement | null>(null);
  const recoveryStartedRef = useRef(false);
  const demoRunRef = useRef(0);
  const sessionInitRef = useRef(false);
  const microVoiceRef = useRef(new MicroVoiceGesture());
  const microReleaseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const knobHoldTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const knobHeldRef = useRef(false);
  const selectedJobRef = useRef<string | null>(null);
  const jobRevisionRef = useRef(0);
  const jobMutationRef = useRef(0);

  function selectJob(id: string | null) {
    selectedJobRef.current = id;
    jobRevisionRef.current = 0;
    jobMutationRef.current += 1;
    setJobId(id);
  }

  const busy = status === 'queued' || status === 'running';
  const voiceBusy = isPreparingVoice || isListening || isFinalizingVoice || isTranscribing;
  const canExecute = Boolean(prompt.trim() || capturePath) && !busy && !voiceBusy && !isAddingContext && !isRecoveringJob;
  const latestProgress = [...activity].reverse().find((item) => item.text && item.type !== 'status')?.text
    || (busy ? '正在理解任务' : '等待下一条指令');
  const recentActivity = activity.filter((item) => item.type !== 'message').slice(-4);
  const activeLayout = layouts.find((item) => item.id === layout) || layouts[0];
  const activeAgent = agentOptions.find((item) => item.id === agentProvider) || agentOptions[0];
  const readyProviderCount = providers.filter((provider) => provider.available && provider.authenticated).length;
  const onboardingReady = connectionState === 'online' && (connection.mode === 'demo' || readyProviderCount > 0);
  const currentMicroJob: SavedJob | null = jobId ? {
    id: jobId, prompt: taskTitle || prompt || '当前任务', cwd, status, result,
    agentProvider, createdAt: history.find((job) => job.id === jobId)?.createdAt || startedAt || 0, startedAt, events: activity,
  } : null;
  const microTaskSlots = [
    ...(currentMicroJob ? [currentMicroJob] : []),
    ...history.filter((job) => job.id !== jobId),
  ].sort((a, b) => (b.createdAt - a.createdAt) || a.id.localeCompare(b.id)).slice(0, 6);
  const runningTaskCount = history.filter((job) => job.status === 'running' || job.status === 'queued').length;
  const completedTaskCount = history.filter((job) => job.status === 'completed').length;
  const activeMicroKey = microKeys.find((key) => key.id === editingMicroKey) || null;
  const connectionPayload = connection.mode === 'remote' ? connection : { mode: 'local' as const };
  const isMobileDevice = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent)
    || (/Macintosh/i.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
  const canCaptureScreen = !isMobileDevice && typeof navigator.mediaDevices?.getDisplayMedia === 'function';

  function updateConnection(patch: Partial<AgentConnection>) {
    const next = { ...connection, ...patch };
    setConnection(next);
    localStorage.setItem('vibe-panel-connection', JSON.stringify({ mode: next.mode, url: next.url }));
    sessionStorage.setItem('vibe-panel-remote-token', next.token);
    setConnectionState(next.mode === 'remote' ? 'unknown' : 'online');
    setAgentLabel(next.mode === 'demo' ? 'DEMO MODE' : next.mode === 'local' ? 'LOCAL AGENT' : 'REMOTE AGENT');
  }

  function dismissOnboarding(openSettings = false) {
    localStorage.setItem('vibe-panel-onboarding-dismissed', '1');
    setShowOnboarding(false);
    if (openSettings) setShowSettings(true);
  }

  function selectAgentProvider(provider: AgentProviderId) {
    setAgentProvider(provider);
    localStorage.setItem('vibe-panel-agent-provider', provider);
  }

  useEffect(() => { setNativeSelection(null); setNativeList([]); setTerminalReleased(false); }, [cwd, agentProvider, connection.mode]);

  useEffect(() => {
    if (!showHistory || historySource !== 'native' || connection.mode !== 'local') return;
    let cancelled = false;
    let pending = false;
    const refresh = async () => {
      if (pending || document.hidden) return;
      pending = true;
      try {
        const response = await fetch(`/api/native-sessions?${new URLSearchParams({ provider: agentProvider, workspace: cwd })}`, { signal: AbortSignal.timeout(25000) });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || '请更新电脑 Connector 后重试');
        if (cancelled) return;
        setNativeList(payload.sessions || []); setNativeCursor(payload.nextCursor || null); setNativeError('');
      } catch (error) { if (!cancelled) setNativeError(error instanceof Error ? error.message : '无法读取会话'); }
      finally { pending = false; if (!cancelled) setNativeLoading(false); }
    };
    setNativeLoading(true); setNativeList([]); void refresh();
    const timer = window.setInterval(() => { void refresh(); }, 5000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [showHistory, historySource, agentProvider, cwd, connection.mode]);

  async function moreNativeSessions() {
    if (!nativeCursor || nativeLoading) return;
    setNativeLoading(true);
    try {
      const response = await fetch(`/api/native-sessions?${new URLSearchParams({ provider: agentProvider, workspace: cwd, cursor: nativeCursor })}`);
      const payload = await response.json(); if (!response.ok) throw new Error(payload.error);
      setNativeList(items => [...items, ...(payload.sessions || []).filter((s: NativeSession) => !items.some(i => i.id === s.id))]);
      setNativeCursor(payload.nextCursor || null);
    } catch (error) { setNativeError(error instanceof Error ? error.message : '无法读取会话'); }
    finally { setNativeLoading(false); }
  }

  useEffect(() => {
    if (!nativeSelection || connection.mode !== 'local') return;
    let cancelled = false;
    let pending = false;
    const refresh = async () => {
      if (pending || document.hidden) return;
      pending = true;
      try {
        const response = await fetch(`/api/native-sessions/${nativeSelection.provider}/${nativeSelection.id}?${new URLSearchParams({ workspace: nativeSelection.cwd })}`, { signal: AbortSignal.timeout(25000) });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error);
        if (!cancelled) { setNativeSelection(payload); setNativeError(''); }
      } catch (error) { if (!cancelled) setNativeError(error instanceof Error ? error.message : '无法刷新原生会话'); }
      finally { pending = false; }
    };
    void refresh(); const timer = window.setInterval(() => { void refresh(); }, 3000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [nativeSelection?.id, nativeSelection?.provider, connection.mode]);

  function chooseNativeSession(session: NativeSession) {
    if (busy || voiceBusy || isRecoveringJob) return;
    selectJob(null); setStatus('idle'); setResult(''); setActivity([]); setPrompt('');
    setNativeSelection(session); setTerminalReleased(false); setNativeError(''); setShowHistory(false);
    localStorage.removeItem(ACTIVE_JOB_KEY);
  }

  async function resumeNativeSession(command: string) {
    if (!nativeSelection || !terminalReleased || !nativeSelection.canResume) return;
    setStatus('queued'); setError('');
    try {
      const response = await fetch(`/api/native-sessions/${nativeSelection.provider}/${nativeSelection.id}/resume`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: command, cwd: nativeSelection.cwd, terminalReleased }),
      });
      const payload = await response.json(); if (!response.ok) throw new Error(payload.error);
      setTaskTitle(nativeSelection.title); setNativeSelection(null); setPrompt(''); setResult(''); setActivity([]);
      setCapturePath(''); setCapturePreview(''); setStartedAt(Date.now()); selectJob(payload.id);
      localStorage.setItem(ACTIVE_JOB_KEY, payload.id);
    } catch (error) { setStatus('idle'); setError(error instanceof Error ? error.message : '无法接续会话'); }
  }

  function updateProviders(nextProviders: AgentProviderInfo[]) {
    if (!Array.isArray(nextProviders)) return;
    setProviders(nextProviders);
    const selected = nextProviders.find((provider) => provider.id === agentProvider);
    if (selected?.available && selected.authenticated) return;
    const ready = nextProviders.find((provider) => provider.available && provider.authenticated);
    if (ready) selectAgentProvider(ready.id);
  }

  async function connectWithCode(codeInput: string, quiet = false) {
    const code = codeInput.trim();
    if (!code) return false;
    setPairingBusy(true);
    if (!quiet) setError('');
    try {
      const response = await fetch('/api/pair', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, deviceName: isMobileDevice ? 'Mobile panel' : 'Browser panel' }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || '配对失败');
      setPairedDevice(payload.device || null);
      setPairCode('');
      updateConnection({ mode: 'local' });
      setConnectionState('online');
      setAgentLabel('LOCAL AGENT');
      const url = new URL(window.location.href);
      url.searchParams.delete('pair');
      window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
      return true;
    } catch (reason) {
      if (!quiet) setError(reason instanceof Error ? reason.message : '配对失败');
      return false;
    } finally {
      setPairingBusy(false);
    }
  }

  async function loadDevices() {
    try {
      const response = await fetch('/api/devices');
      if (!response.ok) {
        setPairingAdmin(false);
        return;
      }
      const payload = await response.json();
      setPairingAdmin(true);
      setDevices(Array.isArray(payload.devices) ? payload.devices : []);
    } catch {
      setPairingAdmin(false);
    }
  }

  async function createPairingCode() {
    setPairingBusy(true);
    setError('');
    try {
      localStorage.setItem('vibe-panel-public-url', publicUrl.trim());
      const response = await fetch('/api/pairing-codes', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ publicUrl: publicUrl.trim() }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || '无法生成配对码');
      setPairingInfo(payload);
      setPairingQr(await QRCode.toDataURL(payload.pairingUrl, { width: 280, margin: 1, errorCorrectionLevel: 'M' }));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '无法生成配对码');
    } finally {
      setPairingBusy(false);
    }
  }

  async function revokeDevice(deviceId: string) {
    const response = await fetch(`/api/devices/${deviceId}`, { method: 'DELETE' });
    if (response.ok) setDevices((items) => items.filter((item) => item.id !== deviceId));
  }

  async function testConnection() {
    if (connection.mode === 'demo') {
      setConnectionState('online');
      setAgentLabel('DEMO MODE');
      return;
    }
    setConnectionState('checking');
    setError('');
    try {
      const response = await fetch('/api/connections/test', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ connection: connectionPayload }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'Agent 连接失败');
      updateProviders(payload.providers || []);
      setConnectionState('online');
      setAgentLabel(connection.mode === 'remote' ? payload.name || 'REMOTE AGENT' : 'LOCAL AGENT');
    } catch (reason) {
      setConnectionState('offline');
      setError(reason instanceof Error ? reason.message : 'Agent 连接失败');
    }
  }

  function selectTheme(nextTheme: ThemeId) {
    setTheme(nextTheme);
    localStorage.setItem('vibe-panel-theme', nextTheme);
  }

  function selectLayout(nextLayout: LayoutId) {
    setLayout(nextLayout);
    localStorage.setItem('vibe-panel-layout', nextLayout);
  }

  function updateMicroKey(id: MicroKeyId, patch: Partial<MicroKeyConfig>) {
    setMicroKeys((items) => {
      const next = updateMicroConfiguration(items, id, patch);
      localStorage.setItem('vibe-panel-micro-keys', JSON.stringify(next));
      localStorage.setItem('vibe-panel-micro-keys-version', MICRO_KEYS_VERSION);
      return next;
    });
  }

  function resetMicroKeys() {
    const defaults = defaultMicroKeys.map((item) => ({ ...item }));
    setMicroKeys(defaults);
    setEditingMicroKey(null);
    localStorage.setItem('vibe-panel-micro-keys', JSON.stringify(defaults));
    localStorage.setItem('vibe-panel-micro-keys-version', MICRO_KEYS_VERSION);
  }

  useEffect(() => {
    if (!busy || !startedAt) return;
    const tick = () => setElapsed(Date.now() - startedAt);
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [busy, startedAt]);

  useEffect(() => { latestPromptRef.current = prompt; }, [prompt]);

  useEffect(() => {
    if (layout !== 'hardware-micro' || knobIndex === null) return;
    const target = document.querySelector(composerTargets[knobIndex]);
    target?.classList.add('micro-knob-target');
    return () => target?.classList.remove('micro-knob-target');
  }, [knobIndex, layout, result]);

  useEffect(() => {
    if (layout !== 'hardware-micro') return;
    const cancel = () => { cancelMicroVoice(); if (knobHoldTimerRef.current) clearTimeout(knobHoldTimerRef.current); };
    const hidden = () => { if (document.hidden) cancel(); };
    window.addEventListener('blur', cancel);
    document.addEventListener('visibilitychange', hidden);
    return () => { window.removeEventListener('blur', cancel); document.removeEventListener('visibilitychange', hidden); cancel(); };
  }, [layout]);

  useEffect(() => {
    if (showSettings) void loadDevices();
  // Device administration is intentionally probed only while settings are visible.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showSettings]);

  useEffect(() => {
    if (sessionInitRef.current) return;
    sessionInitRef.current = true;
    const initialize = async () => {
      try {
        const response = await fetch('/api/health');
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || '无法连接控制面板');
        if (payload.publicUrl) {
          setPublicUrl(payload.publicUrl);
          localStorage.setItem('vibe-panel-public-url', payload.publicUrl);
        }
        updateProviders(payload.providers || []);
        setPairedDevice(payload.device || null);
        if (payload.pairingRequired && !payload.paired) {
          const code = new URL(window.location.href).searchParams.get('pair') || '';
          const paired = code ? await connectWithCode(code, true) : false;
          if (!paired) updateConnection({ mode: 'demo' });
        } else if (connection.mode === 'local') {
          setConnectionState('online');
          setAgentLabel('LOCAL AGENT');
        }
        void loadDevices();
      } catch (reason) {
        setConnectionState('offline');
        setError(reason instanceof Error ? reason.message : '无法连接控制面板');
      } finally {
        setAuthReady(true);
      }
    };
    void initialize();
  // Initial session check must run once before job recovery.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Discover tasks from other paired browsers, even when our selected task is
  // finished. Selection and drafts stay local; task state comes from Connector.
  useEffect(() => {
    if (!authReady || connection.mode === 'demo') return;
    let cancelled = false;
    let pending = false;
    const controller = new AbortController();
    const sync = async () => {
      if (pending || document.hidden) return;
      pending = true;
      try {
        const response = await fetch('/api/jobs', { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10000)]), cache: 'no-store' });
        if (!response.ok) return;
        const payload = await response.json() as { jobs?: SavedJob[] };
        if (cancelled || !Array.isArray(payload.jobs)) return;
        // Replace browser history with this Connector's list. Do not mix task
        // records from another computer or demo into a newly paired session.
        setHistory(payload.jobs);
        const selected = selectedJobRef.current && payload.jobs.find((job) => job.id === selectedJobRef.current);
        if (selected && selected.revision !== undefined && selected.revision >= jobRevisionRef.current) {
          jobRevisionRef.current = selected.revision;
          setStatus(selected.status);
          if (selected.startedAt) setStartedAt(selected.startedAt);
          if (['completed', 'failed', 'stopped'].includes(selected.status)) void refreshJob(selected.id);
        }
      } catch { /* Keep the last list during a temporary disconnect. */ }
      finally { pending = false; }
    };
    void sync();
    const timer = window.setInterval(() => { void sync(); }, 2000);
    window.addEventListener('focus', sync);
    document.addEventListener('visibilitychange', sync);
    return () => {
      cancelled = true;
      controller.abort();
      window.clearInterval(timer);
      window.removeEventListener('focus', sync);
      document.removeEventListener('visibilitychange', sync);
    };
  }, [authReady, connection.mode]);

  useEffect(() => {
    if (!authReady) return;
    if (connection.mode === 'demo') {
      setIsRecoveringJob(false);
      return;
    }
    if (recoveryStartedRef.current) return;
    recoveryStartedRef.current = true;
    const activeJobId = localStorage.getItem(ACTIVE_JOB_KEY);
    if (!activeJobId) {
      setIsRecoveringJob(false);
      return;
    }

    const recover = async () => {
      try {
        const response = await fetch(`/api/jobs/${activeJobId}`);
        if (response.status === 404) {
          localStorage.removeItem(ACTIVE_JOB_KEY);
          return;
        }
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || '无法恢复上次任务');
        restoreJob(payload as SavedJob);
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : '无法恢复上次任务');
      } finally {
        setIsRecoveringJob(false);
      }
    };
    void recover();
  // Recovery runs once even under React StrictMode.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authReady, connection.mode]);

  useEffect(() => () => {
    voiceSessionRef.current += 1;
    voiceStartPendingRef.current = false;
    shouldTranscribeRef.current = false;
    if (mediaRecorderRef.current?.state !== 'inactive') mediaRecorderRef.current?.stop();
    microphoneStreamRef.current?.getTracks().forEach((track) => track.stop());
  }, []);

  useEffect(() => {
    if (!jobId || !busy || isRecoveringJob || connection.mode === 'demo') return;
    const stream = new EventSource(`/api/jobs/${jobId}/events`);
    stream.onmessage = (message) => {
      const event = JSON.parse(message.data) as Activity;
      if (selectedJobRef.current !== jobId) return;
      if (event.revision && event.revision < jobRevisionRef.current) return;
      if (event.revision) jobRevisionRef.current = event.revision;
      setActivity((items) => items.some((item) => item.id === event.id) ? items : [...items, event]);
      if (event.type === 'message' && event.text) setResult(event.text);
      if (event.type === 'status' && event.status) {
        const nextStatus = event.status as JobStatus;
        setStatus(nextStatus);
        if (['completed', 'failed', 'stopped'].includes(nextStatus)) {
          stream.close();
          void refreshJob(jobId);
        }
      }
    };
    stream.onerror = () => setError((current) => current || '实时连接中断，正在自动恢复进度');
    return () => stream.close();
  // Follow-ups keep the same job id, so streamVersion explicitly starts a new subscription.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId, streamVersion, busy, isRecoveringJob, connection.mode]);

  // Finished tasks can be resumed on another device. Keep checking them too.
  useEffect(() => {
    if (!jobId || isRecoveringJob || connection.mode === 'demo') return;
    let pending = false;
    const sync = async () => {
      if (pending || document.hidden) return;
      pending = true;
      try { await refreshJob(jobId); } finally { pending = false; }
    };
    void sync();
    const timer = window.setInterval(() => { void sync(); }, 2000);
    window.addEventListener('focus', sync);
    document.addEventListener('visibilitychange', sync);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', sync);
      document.removeEventListener('visibilitychange', sync);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId, busy, isRecoveringJob, connection.mode, streamVersion]);

  const duration = useMemo(() => {
    const seconds = Math.max(0, Math.floor(elapsed / 1000));
    return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
  }, [elapsed]);

  async function refreshJob(id: string) {
    const mutation = jobMutationRef.current;
    try {
      const response = await fetch(`/api/jobs/${id}`, { cache: 'no-store', signal: AbortSignal.timeout(10000) });
      if (selectedJobRef.current !== id || jobMutationRef.current !== mutation) return;
      if (response.status === 404) {
        if (localStorage.getItem(ACTIVE_JOB_KEY) === id) localStorage.removeItem(ACTIVE_JOB_KEY);
        return;
      }
      if (!response.ok) return;
      const job = await response.json() as SavedJob;
      if (selectedJobRef.current !== id || jobMutationRef.current !== mutation) return;
      if (job.revision !== undefined && job.revision < jobRevisionRef.current) return;
      jobRevisionRef.current = job.revision || 0;
      setError((current) => current === '实时连接中断，正在自动恢复进度' ? '' : current);
      setStatus(job.status);
      setActivity(Array.isArray(job.events) ? job.events : []);
      setResult(job.result || '');
      if (job.startedAt) setStartedAt(job.startedAt);
    } catch { /* Connection errors are shown by the event stream. */ }
  }

  function storeJobInHistory(job: SavedJob) {
    setHistory((items) => {
      const next = [job, ...items.filter((item) => item.id !== job.id)].slice(0, 20);
      localStorage.setItem('vibe-panel-history', JSON.stringify(next));
      return next;
    });
  }

  function restoreJob(job: SavedJob) {
    const jobStartedAt = job.startedAt || job.createdAt;
    setPrompt('');
    setTaskTitle(job.prompt);
    setCwd(job.cwd);
    if (job.agentProvider) selectAgentProvider(job.agentProvider);
    setStatus(job.status);
    setActivity(Array.isArray(job.events) ? job.events : []);
    setResult(job.result || '');
    setStartedAt(jobStartedAt);
    setElapsed(Math.max(0, (job.finishedAt || Date.now()) - jobStartedAt));
    selectJob(job.id);
    jobRevisionRef.current = job.revision || 0;
    localStorage.setItem(ACTIVE_JOB_KEY, job.id);
    localStorage.setItem('vibe-panel-cwd', job.cwd);
  }

  function buildCommand() {
    const text = prompt.trim();
    if (!capturePath) return text;
    const captureInstruction = connection.mode === 'demo'
      ? '结合已添加的图片上下文完成任务。'
      : `查看图片上下文 ${capturePath}，结合画面完成任务。`;
    return [text, captureInstruction].filter(Boolean).join('\n\n');
  }

  async function execute(event?: FormEvent) {
    event?.preventDefault();
    const command = buildCommand();
    if (!command || !canExecute) return;
    if (connection.mode === 'demo') {
      await runDemo(command);
      return;
    }
    if (nativeSelection) { await resumeNativeSession(command); return; }
    if (jobId && result) await followUp(command);
    else await submit(command);
  }

  async function runDemo(command: string) {
    const runId = demoRunRef.current + 1;
    demoRunRef.current = runId;
    const id = `demo-${Date.now()}`;
    const createdAt = Date.now();
    const title = prompt.trim() || '分析图片';
    const demoEvents: Activity[] = [];
    const addEvent = (type: string, text: string, eventStatus?: string) => {
      const item = { id: demoEvents.length + 1, at: Date.now(), type, text, status: eventStatus };
      demoEvents.push(item);
      setActivity([...demoEvents]);
    };
    const wait = (milliseconds: number) => new Promise((resolve) => window.setTimeout(resolve, milliseconds));

    setError(''); setActivity([]); setResult(''); setStatus('queued'); setStartedAt(createdAt);
    setTaskTitle(title); setPrompt(''); setCapturePath(''); setCapturePreview(''); selectJob(id);
    await wait(450);
    if (demoRunRef.current !== runId) return;
    setStatus('running');
    addEvent('status', '演示 Agent 已开始工作', 'running');
    for (const step of ['正在理解任务和 Workspace 上下文', '正在检查相关文件', '正在生成修改并运行验证']) {
      await wait(650);
      if (demoRunRef.current !== runId) return;
      addEvent('progress', step);
    }
    const finalResult = `演示任务已完成：${command.slice(0, 72)}${command.length > 72 ? '...' : ''}\n\n连接电脑上的 Agent 后，这里会显示真实的文件修改、命令进度和最终结果。`;
    setResult(finalResult);
    setStatus('completed');
    addEvent('message', finalResult);
    addEvent('status', '演示任务完成', 'completed');
    storeJobInHistory({
      id, prompt: title, cwd: 'Demo workspace', status: 'completed', result: finalResult,
      createdAt, startedAt: createdAt, finishedAt: Date.now(), events: demoEvents,
    });
  }

  async function submit(command: string, title = prompt.trim() || '分析图片') {
    selectJob(null);
    setError(''); setActivity([]); setResult(''); setStatus('queued'); setStartedAt(Date.now());
    localStorage.setItem('vibe-panel-cwd', cwd);
    try {
      const response = await fetch('/api/jobs', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: command, cwd, agentProvider, connection: connectionPayload }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || '任务启动失败');
      setTaskTitle(title);
      setPrompt(''); setCapturePath(''); setCapturePreview(''); selectJob(payload.id);
      localStorage.setItem(ACTIVE_JOB_KEY, payload.id);
    } catch (reason) {
      setStatus('failed');
      setStartedAt(null);
      setError(reason instanceof Error ? reason.message : '任务启动失败');
    }
  }

  async function followUp(command: string) {
    if (!jobId) return;
    jobMutationRef.current += 1;
    setError(''); setStatus('queued'); setStartedAt(Date.now());
    try {
      const response = await fetch(`/api/jobs/${jobId}/follow-up`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: command }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || '无法继续任务');
      setPrompt(''); setCapturePath(''); setCapturePreview(''); setActivity([]); setResult('');
      setStreamVersion((version) => version + 1);
    } catch (reason) {
      setStatus('failed');
      setError(reason instanceof Error ? reason.message : '无法继续任务');
    }
  }

  async function stop() {
    if (!jobId || !busy) return;
    if (connection.mode === 'demo') {
      demoRunRef.current += 1;
      setStatus('stopped');
      setActivity((items) => [...items, { id: items.length + 1, at: Date.now(), type: 'status', text: '演示任务已停止', status: 'stopped' }]);
      return;
    }
    await fetch(`/api/jobs/${jobId}/stop`, { method: 'POST' });
  }

  function reset() {
    if (busy || voiceBusy || isAddingContext || isRecoveringJob) return;
    setNativeSelection(null); setTerminalReleased(false);
    demoRunRef.current += 1;
    voiceSessionRef.current += 1;
    voiceStartPendingRef.current = false;
    stopListening(false);
    setIsPreparingVoice(false); setIsTranscribing(false); setCanImportRecording(false);
    setPrompt(''); setTaskTitle(''); selectJob(null); setStreamVersion(0); setStatus('idle');
    setActivity([]); setResult(''); setError(''); setCapturePath(''); setCapturePreview('');
    setStartedAt(null); setElapsed(0);
    localStorage.removeItem(ACTIVE_JOB_KEY);
    setShowWorkspacePicker(false);
  }

  function stopListening(transcribe = true) {
    if (voiceStartPendingRef.current && !mediaRecorderRef.current) {
      voiceSessionRef.current += 1;
      voiceStartPendingRef.current = false;
      setIsPreparingVoice(false);
    }
    shouldTranscribeRef.current = transcribe;
    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state !== 'inactive') {
      voiceFinalizingRef.current = true;
      setIsFinalizingVoice(true);
      recorder.stop();
    }
    setIsListening(false);
  }

  function microphoneErrorMessage(reason: unknown) {
    if (!(reason instanceof DOMException)) return reason instanceof Error ? reason.message : '无法启动麦克风';
    if (reason.name === 'NotAllowedError' || reason.name === 'SecurityError') {
      return '麦克风未授权，请在当前网站的权限设置中允许麦克风后重试';
    }
    if (reason.name === 'NotFoundError' || reason.name === 'DevicesNotFoundError') return '没有检测到可用麦克风';
    if (reason.name === 'NotReadableError' || reason.name === 'TrackStartError') return '麦克风正被其他应用占用';
    return `无法启动麦克风：${reason.message || reason.name}`;
  }

  async function transcribeRecording(blob: Blob, voiceSession: number) {
    setIsTranscribing(true);
    setCanImportRecording(false);
    setError('');
    try {
      const response = await fetch('/api/transcriptions', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ audio: await audioDataUrl(blob), language: 'zh' }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || '录音转写失败');
      if (voiceSession !== voiceSessionRef.current) return;
      const transcript = String(payload.text || '').trim();
      if (!transcript) throw new Error('没有识别到语音，请靠近麦克风后重试');
      const nextPrompt = [speechBaseRef.current, transcript].filter(Boolean).join(' ');
      latestPromptRef.current = nextPrompt;
      setPrompt(nextPrompt);
    } catch (reason) {
      if (voiceSession === voiceSessionRef.current) {
        setCanImportRecording(true);
        setError(reason instanceof Error ? reason.message : '录音转写失败');
      }
    } finally {
      if (voiceSession === voiceSessionRef.current) setIsTranscribing(false);
    }
  }

  async function startListening() {
    if (connection.mode === 'demo') {
      setError('演示模式不上传录音。与电脑完成配对后可使用本机 Whisper 语音输入');
      return;
    }
    if (voiceStartPendingRef.current || voiceFinalizingRef.current || mediaRecorderRef.current || isTranscribing) return;
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setError('当前浏览器不支持录音，请使用最新版 Chrome、Edge 或 Safari');
      return;
    }
    const voiceSession = voiceSessionRef.current + 1;
    voiceSessionRef.current = voiceSession;
    voiceStartPendingRef.current = true;
    setIsPreparingVoice(true);
    let stream: MediaStream | null = null;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          autoGainControl: true,
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
        },
      });
      if (voiceSession !== voiceSessionRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      const preferredTypes = recordingMimeTypes(navigator.userAgent, navigator.maxTouchPoints);
      const mimeType = preferredTypes.find((type) => MediaRecorder.isTypeSupported(type));
      const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
      const chunks: Blob[] = [];
      const recordingStream = stream;
      let startedAt = 0;
      let recordingFailed = false;
      speechBaseRef.current = latestPromptRef.current.trim();
      shouldTranscribeRef.current = true;
      microphoneStreamRef.current = stream;
      mediaRecorderRef.current = recorder;
      recorder.onstart = () => { startedAt = performance.now(); };
      recorder.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };
      recorder.onerror = () => {
        recordingFailed = true;
        setCanImportRecording(true);
        setError('录音被浏览器中断，请重试');
        stopListening(false);
      };
      recorder.onstop = async () => {
        voiceFinalizingRef.current = true;
        setIsFinalizingVoice(true);
        const shouldTranscribe = shouldTranscribeRef.current && !recordingFailed;
        recordingStream.getTracks().forEach((track) => track.stop());
        if (mediaRecorderRef.current === recorder) {
          microphoneStreamRef.current = null;
          mediaRecorderRef.current = null;
        }
        try {
          if (!shouldTranscribe || voiceSession !== voiceSessionRef.current) return;
          setIsListening(false);
          if (!startedAt || performance.now() - startedAt < MIN_RECORDING_MS) {
            throw new Error('录音太短，请等待录音开始后说完一句话，再结束录音');
          }
          const recordedType = chunks[0]?.type || recorder.mimeType || mimeType || 'audio/webm';
          const recording = new Blob(chunks, { type: recordedType });
          await validateRecording(recording);
          if (voiceSession === voiceSessionRef.current) await transcribeRecording(recording, voiceSession);
        } catch (error) {
          if (voiceSession === voiceSessionRef.current) {
            setCanImportRecording(true);
            setError(error instanceof Error ? error.message : '录音无法读取，请重试');
          }
        } finally {
          voiceFinalizingRef.current = false;
          setIsFinalizingVoice(false);
        }
      };
      setError('');
      setCanImportRecording(false);
      setIsListening(true);
      // Keep every chunk, including the final dataavailable fired before stop.
      recorder.start(1000);
    } catch (reason) {
      stream?.getTracks().forEach((track) => track.stop());
      if (voiceSession === voiceSessionRef.current) {
        mediaRecorderRef.current = null;
        microphoneStreamRef.current = null;
        setIsListening(false);
        setCanImportRecording(true);
        setError(microphoneErrorMessage(reason));
      }
    } finally {
      if (voiceSession === voiceSessionRef.current) {
        voiceStartPendingRef.current = false;
        setIsPreparingVoice(false);
      }
    }
  }

  function toggleSpeech() {
    if (isListening) stopListening(true);
    else void startListening();
  }

  async function importAudioRecording(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    const voiceSession = voiceSessionRef.current + 1;
    voiceSessionRef.current = voiceSession;
    speechBaseRef.current = latestPromptRef.current.trim();
    const extension = file.name.split('.').pop()?.toLowerCase();
    const fallbackType = extension === 'm4a' ? 'audio/x-m4a' : extension ? `audio/${extension}` : 'audio/mp4';
    const recording = file.type.startsWith('audio/') ? file : new Blob([file], { type: fallbackType });
    await transcribeRecording(recording, voiceSession);
  }

  async function togglePanelMode() {
    const next = !isPanelMode;
    setIsPanelMode(next);
    try {
      if (next && document.documentElement.requestFullscreen) await document.documentElement.requestFullscreen();
      else if (!next && document.fullscreenElement) await document.exitFullscreen();
    } catch {
      // Focus mode still works when a mobile browser does not expose native fullscreen.
    }
  }

  async function browseWorkspace(pathToOpen: string) {
    if (connection.mode === 'demo') {
      setWorkspacePath('Demo workspace');
      setWorkspaceResolvedPath('Demo workspace');
      setWorkspaceParent(null);
      setWorkspaceDirectories([]);
      setWorkspaceError('');
      return;
    }
    setWorkspacePath(pathToOpen);
    setWorkspaceLoading(true);
    setWorkspaceError('');
    try {
      const response = await fetch('/api/workspaces', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: pathToOpen, connection: connectionPayload }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || '无法读取该目录');
      setWorkspacePath(payload.path);
      setWorkspaceResolvedPath(payload.path);
      setWorkspaceParent(payload.parent || null);
      setWorkspaceDirectories(Array.isArray(payload.directories) ? payload.directories : []);
    } catch (reason) {
      setWorkspaceResolvedPath('');
      setWorkspaceDirectories([]);
      setWorkspaceError(reason instanceof Error ? reason.message : '无法读取该目录');
    } finally {
      setWorkspaceLoading(false);
    }
  }

  function openWorkspacePicker() {
    if (busy) return;
    setShowWorkspacePicker(true);
    void browseWorkspace(cwd);
  }

  function selectWorkspace() {
    const nextWorkspace = workspaceResolvedPath;
    if (!nextWorkspace || workspaceLoading || workspaceError) return;
    setCwd(nextWorkspace);
    localStorage.setItem('vibe-panel-cwd', nextWorkspace);
    if (jobId) {
      selectJob(null); setStreamVersion(0); setTaskTitle(''); setStatus('idle');
      setActivity([]); setResult(''); setStartedAt(null);
      localStorage.removeItem(ACTIVE_JOB_KEY);
    }
    setShowWorkspacePicker(false);
  }

  async function saveContextImage(dataUrl: string) {
    if (connection.mode === 'demo') {
      setCapturePath('demo-image');
      setCapturePreview(dataUrl);
      return;
    }
    const response = await fetch('/api/captures', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cwd, image: dataUrl, connection: connectionPayload }),
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || '图片保存失败');
    setCapturePath(payload.path);
    setCapturePreview(dataUrl);
  }

  async function addImageContext(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setError(''); setCanImportRecording(false); setIsAddingContext(true);
    try {
      await saveContextImage(await imageDataUrl(file));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '无法添加图片');
    } finally {
      setIsAddingContext(false);
    }
  }

  async function captureScreen() {
    if (isCapturing) return;
    if (!navigator.mediaDevices?.getDisplayMedia) {
      setError('当前浏览器不支持屏幕捕获');
      return;
    }
    setError(''); setCanImportRecording(false); setIsCapturing(true);
    let stream: MediaStream | null = null;
    try {
      stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
      const video = document.createElement('video');
      video.srcObject = stream;
      await new Promise<void>((resolve) => { video.onloadedmetadata = () => resolve(); });
      await video.play();
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth; canvas.height = video.videoHeight;
      canvas.getContext('2d')?.drawImage(video, 0, 0);
      const dataUrl = canvas.toDataURL('image/jpeg', 0.86);
      await saveContextImage(dataUrl);
    } catch (reason) {
      if (reason instanceof DOMException && reason.name === 'NotAllowedError') setError('已取消屏幕捕获');
      else setError(reason instanceof Error ? reason.message : '屏幕捕获失败');
    } finally {
      stream?.getTracks().forEach((track) => track.stop());
      setIsCapturing(false);
    }
  }

  function addVisualContext() {
    if (canCaptureScreen) void captureScreen();
    else imageInputRef.current?.click();
  }

  function loadJob(job: SavedJob) {
    if (busy || voiceBusy || isRecoveringJob || isAddingContext) return;
    setNativeSelection(null);
    if (jobId !== job.id) {
      const previous = microNavigation.length ? microNavigation.slice(0, microNavigationIndex + 1) : jobId ? [jobId] : [];
      const next = [...previous, job.id];
      setMicroNavigation(next);
      setMicroNavigationIndex(next.length - 1);
    }
    setStreamVersion((version) => version + 1);
    restoreJob(job);
    setShowHistory(false);
    if (!job.id.startsWith('demo-')) void refreshJob(job.id);
  }

  function triggerMicroAction(key: MicroKeyConfig) {
    const unavailable = unavailableMicroAction(key.action);
    if (unavailable) { setError(unavailable); return; }
    if (microActionDisabled(key)) return;
    if (key.action === 'voice') void toggleSpeech();
    else if (key.action === 'execute') void execute();
    else if (key.action === 'stop') void stop();
    else if (key.action === 'new') reset();
    else if (key.action === 'history') setShowHistory(true);
    else if (key.action === 'workspace') openWorkspacePicker();
    else if (key.action === 'capture') addVisualContext();
    else if (key.action === 'fullscreen') void togglePanelMode();
    else if (key.action === 'settings') setShowSettings(true);
    else if (key.action === 'prompt') { setPrompt(key.prompt.trim()); promptRef.current?.focus(); }
  }

  function microActionDisabled(key: MicroKeyConfig) {
    if (unavailableMicroAction(key.action)) return true;
    if (key.action === 'stop') return !busy;
    if (key.action === 'execute') return !canExecute;
    if (key.action === 'voice') return busy || isFinalizingVoice || isTranscribing || isAddingContext || isRecoveringJob;
    if (key.action === 'history' || key.action === 'fullscreen' || key.action === 'settings') return false;
    return busy || voiceBusy || isAddingContext || isRecoveringJob || (key.action === 'prompt' && !key.prompt.trim());
  }

  function clearMicroReleaseTimer() {
    if (microReleaseTimerRef.current) clearTimeout(microReleaseTimerRef.current);
    microReleaseTimerRef.current = null;
  }

  function pressMicroVoice() {
    clearMicroReleaseTimer();
    const action = microVoiceRef.current.press(performance.now());
    if (action === 'stop') stopListening(true);
    if (action === 'start') void startListening();
  }

  function releaseMicroVoice() {
    const action = microVoiceRef.current.release(performance.now());
    if (action === 'stop') stopListening(true);
    if (action === 'defer') {
      const delay = Math.max(0, 350 - (performance.now() - (microVoiceRef.current.lastTapAt ?? 0)));
      microReleaseTimerRef.current = setTimeout(() => {
        microReleaseTimerRef.current = null;
        microVoiceRef.current.reset();
        stopListening(true);
      }, delay);
    }
  }

  function cancelMicroVoice() {
    clearMicroReleaseTimer();
    microVoiceRef.current.reset();
    stopListening(false);
  }

  const composerTargets = ['#command', '.context-action', '.workspace-readout'];
  function turnMicroKnob(direction: number) {
    setKnobIndex((index) => ((index ?? (direction > 0 ? -1 : 0)) + direction + composerTargets.length) % composerTargets.length);
  }
  function selectMicroKnob() {
    if (knobHeldRef.current) { knobHeldRef.current = false; return; }
    const target = document.querySelector<HTMLButtonElement | HTMLTextAreaElement>(composerTargets[knobIndex ?? 0]);
    if (!target || target.disabled) return;
    if (target instanceof HTMLTextAreaElement) target.focus();
    else target.click();
  }
  function navigateMicro(direction: number) {
    if (busy || voiceBusy || isRecoveringJob || isAddingContext) return;
    const next = microNavigationIndex + direction;
    const task = history.find((job) => job.id === microNavigation[next]);
    if (!task) return;
    setMicroNavigationIndex(next);
    restoreJob(task);
    setStreamVersion((version) => version + 1);
    if (!task.id.startsWith('demo-')) void refreshJob(task.id);
  }

  function renderMicroAgentKey(index: number) {
    const task = microTaskSlots[index];
    const slotState = task?.status === 'completed' && task.id === jobId ? 'idle' : task?.status || 'empty';
    const title = task ? `${statusLabels[task.status]} · ${task.prompt}` : '空任务槽 · 新建任务';
    const cancel = index === 0 && knobIndex !== null;
    return <button type="button" key={`agent-${index}`} className={`micro-agent-key slot-${index + 1} ${slotState} ${task?.id === jobId ? 'selected' : ''} ${cancel ? 'cancel' : ''}`} disabled={!cancel && (busy || voiceBusy || isRecoveringJob || isAddingContext)} onClick={() => { if (cancel) { setKnobIndex(null); return; } task ? loadJob(task) : reset(); }} title={cancel ? '取消旋钮选择' : title} aria-label={cancel ? '取消旋钮选择' : `任务槽 ${index + 1}：${title}`}><i /><span>{index + 1}</span></button>;
  }

  function renderMicroCommandKey(key: MicroKeyConfig) {
    const voice = key.action === 'voice';
    const unavailable = unavailableMicroAction(key.action);
    const label = `${key.label} · ${unavailable || microActions.find((action) => action.id === key.action)?.label || ''}`;
    return <button type="button" key={key.id} className={`micro-command-key micro-${key.id} micro-color-${key.color} ${voice && isListening ? 'listening' : ''} ${voice && (isPreparingVoice || isTranscribing) ? 'transcribing' : ''} ${unavailable ? 'unavailable' : ''}`}
      aria-label={label} aria-disabled={Boolean(unavailable) || undefined} title={label}
      disabled={!unavailable && microActionDisabled(key)}
      onPointerDown={voice ? (event) => { if (event.button !== 0) return; event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId); pressMicroVoice(); } : undefined}
      onPointerUp={voice ? () => releaseMicroVoice() : undefined}
      onPointerCancel={voice ? cancelMicroVoice : undefined}
      onLostPointerCapture={voice ? () => { if (microVoiceRef.current.downAt !== null) cancelMicroVoice(); } : undefined}
      onContextMenu={voice ? (event) => event.preventDefault() : undefined}
      onKeyDown={voice ? (event) => { if ((event.key === ' ' || event.key === 'Enter') && !event.repeat) { event.preventDefault(); pressMicroVoice(); } } : undefined}
      onKeyUp={voice ? (event) => { if (event.key === ' ' || event.key === 'Enter') { event.preventDefault(); releaseMicroVoice(); } } : undefined}
      onClick={(event) => { if (!voice) triggerMicroAction(key); else if (event.detail === 0) { if (isListening) { microVoiceRef.current.reset(); stopListening(true); } else { microVoiceRef.current.latched = true; void startListening(); } } }}>
      {renderMicroIcon(key.icon, 24)}<span>{key.label || 'KEY'}</span>
    </button>;
  }

  function renderStopKey(className = '') {
    return <button type="button" className={`console-key dark stop-key ${className}`} onClick={stop} disabled={!busy}><CircleStop size={25} /><span>PAUSE<br />REJECT</span><small>停止</small></button>;
  }

  function renderCaptureKey(className = '') {
    return <button type="button" className={`console-key dark capture-key ${className}`} onClick={addVisualContext} disabled={busy || isCapturing || voiceBusy || isAddingContext}>{isCapturing || isAddingContext ? <RotateCw className="spin" size={25} /> : canCaptureScreen ? <Camera size={25} /> : <ImagePlus size={25} />}<span>{canCaptureScreen ? 'CAPTURE' : 'IMAGE'}</span><small>{canCaptureScreen ? '捕获屏幕' : '选择图片'}</small></button>;
  }

  function renderVoiceKey(className = '', approve = false) {
    const shouldApprove = approve && canExecute;
    return <button type="button" className={`console-key voice-key ${isListening ? 'listening' : ''} ${className}`} onClick={shouldApprove ? () => void execute() : toggleSpeech} disabled={busy || isPreparingVoice || isFinalizingVoice || isTranscribing}>{shouldApprove ? <Check size={29} /> : isListening ? <MicOff size={31} /> : isPreparingVoice || isFinalizingVoice || isTranscribing ? <RotateCw className="spin" size={31} /> : <Mic size={31} />}<span>{shouldApprove ? 'APPROVE' : isListening ? 'LISTENING' : isPreparingVoice ? 'STARTING' : isFinalizingVoice ? 'PROCESSING' : isTranscribing ? 'TRANSCRIBING' : approve ? 'VOICE APPROVE' : 'VOICE INPUT'}</span><small>{shouldApprove ? '批准执行' : isListening ? '再次按下结束' : isPreparingVoice ? '正在打开麦克风' : isFinalizingVoice ? '正在完成录音' : isTranscribing ? '正在转成文字' : '点按开始'}</small></button>;
  }

  function renderExecuteKey(className = '', approve = false) {
    return <button type="submit" className={`console-key dark execute-key ${className}`} disabled={!canExecute}>{approve ? <Check size={27} /> : <Play size={26} fill="currentColor" />}<span>{approve ? 'APPROVE' : 'EXECUTE'}</span><small>{result ? '继续' : '执行'}</small></button>;
  }

  function renderNewTaskKey(className = '') {
    return <button type="button" className={`console-key dark utility-key new-key ${className}`} onClick={reset} disabled={busy || voiceBusy || isAddingContext}><Plus size={24} /><span>NEW</span><small>新任务</small></button>;
  }

  function renderHistoryKey(className = '') {
    return <button type="button" className={`console-key dark utility-key history-key ${className}`} onClick={() => setShowHistory(true)}><History size={24} /><span>HISTORY</span><small>记录</small></button>;
  }

  function renderWorkspaceKey(className = '') {
    return <button type="button" className={`console-key dark utility-key workspace-key ${className}`} onClick={openWorkspacePicker} disabled={busy}><Folder size={24} /><span>WORKSPACE</span><small>切换</small></button>;
  }

  function renderSettingsKey(className = '') {
    return <button type="button" className={`console-key dark utility-key settings-key ${className}`} onClick={() => setShowSettings(true)}><Palette size={24} /><span>MODE</span><small>设置</small></button>;
  }

  function renderFullscreenKey(className = '') {
    return <button type="button" className={`console-key dark utility-key fullscreen-key ${className}`} onClick={() => void togglePanelMode()}>{isPanelMode ? <Minimize2 size={24} /> : <Maximize2 size={24} />}<span>VIEW</span><small>全屏</small></button>;
  }

  function renderControlBank() {
    if (layout === 'hardware-tri') return <>{renderStopKey()}{renderCaptureKey()}{renderVoiceKey('voice-approve-key', true)}</>;
    if (layout === 'hardware-vibebar') return <>
      {renderNewTaskKey('vibebar-side-one')}{renderHistoryKey('vibebar-side-two')}
      <div className="vibebar-strip">{renderSettingsKey()}{renderWorkspaceKey()}{renderFullscreenKey()}{renderHistoryKey()}</div>
      {renderVoiceKey('vibebar-main-one')}{renderCaptureKey('vibebar-main-two')}{renderStopKey('vibebar-main-three')}{renderExecuteKey('vibebar-main-four')}
    </>;
    if (layout === 'hardware-five') return <>
      {renderVoiceKey('five-key-one')}{renderCaptureKey('five-key-two')}{renderNewTaskKey('five-key-three')}{renderStopKey('five-key-four')}{renderExecuteKey('five-key-five')}
    </>;
    if (layout === 'hardware-aha') return <>
      {renderVoiceKey('aha-key-one')}{renderExecuteKey('aha-key-two', true)}{renderStopKey('aha-key-three')}{renderCaptureKey('aha-key-four')}
    </>;
    if (layout === 'hardware-micro') return <>
      <div className="micro-control-knob" role="group" aria-label="旋钮：输入区导航" onWheel={(event) => turnMicroKnob(event.deltaY >= 0 ? 1 : -1)}>
        <button type="button" className="knob-left" onClick={() => turnMicroKnob(-1)} title="逆时针：上一项" aria-label="旋钮逆时针"><RotateCcw size={13} /></button>
        <button type="button" className="knob-push" aria-label="按下旋钮选择，长按打开设置" title="选择输入区控件；长按打开设置"
          onPointerDown={(event) => { if (event.button !== 0) return; event.currentTarget.setPointerCapture(event.pointerId); knobHeldRef.current = false; knobHoldTimerRef.current = setTimeout(() => { knobHeldRef.current = true; setShowSettings(true); }, 600); }}
          onPointerUp={() => { if (knobHoldTimerRef.current) clearTimeout(knobHoldTimerRef.current); }}
          onPointerCancel={() => { if (knobHoldTimerRef.current) clearTimeout(knobHoldTimerRef.current); knobHeldRef.current = true; }}
          onClick={selectMicroKnob}><span /></button>
        <button type="button" className="knob-right" onClick={() => turnMicroKnob(1)} title="顺时针：下一项" aria-label="旋钮顺时针"><RotateCw size={13} /></button>
      </div>
      {Array.from({ length: 6 }, (_, index) => renderMicroAgentKey(index))}
      <div className="micro-joystick" role="group" aria-label="摇杆">
        <span className="joystick-cap" aria-hidden="true" />
        <button type="button" className="joystick-up" aria-disabled="true" aria-label="摇杆向上：计划模式（Bridge 未支持）" title="计划模式（Bridge 未支持）" onClick={() => setError('当前 Bridge 尚未支持原生计划模式')}><ArrowUp size={14} /></button>
        <button type="button" className="joystick-right" disabled={busy || voiceBusy || microNavigationIndex >= microNavigation.length - 1} aria-label="摇杆向右：前进" title="前进" onClick={() => navigateMicro(1)}><ArrowRight size={14} /></button>
        <button type="button" className="joystick-down" aria-label="摇杆向下：切换任务侧栏" title="切换任务侧栏" onClick={() => setShowHistory((open) => !open)}><ArrowDown size={14} /></button>
        <button type="button" className="joystick-left" disabled={busy || voiceBusy || microNavigationIndex <= 0} aria-label="摇杆向左：后退" title="后退" onClick={() => navigateMicro(-1)}><ArrowLeft size={14} /></button>
      </div>
      {microKeys.slice(0, 4).map(renderMicroCommandKey)}
      <div className={`micro-connection ${connectionState}`}><span className="micro-connection-leds" aria-hidden="true"><i /><i /><i /></span><button type="button" onClick={() => setShowSettings(true)} title="连接与配对" aria-label="连接与配对" /></div>
      {microKeys.slice(4).map(renderMicroCommandKey)}
    </>;
    return <>{renderStopKey()}{renderCaptureKey()}{renderVoiceKey()}{renderExecuteKey()}</>;
  }

  function renderSettingsPopover() {
    return <div className="settings-popover">
      <div className="settings-heading"><span>CONTROL SETTINGS</span><button onClick={() => setShowSettings(false)} aria-label="关闭"><X size={16} /></button></div>
      <fieldset className="connection-fieldset">
        <legend>Agent 连接</legend>
        <div className="connection-modes">
          <button type="button" aria-pressed={connection.mode === 'demo'} onClick={() => updateConnection({ mode: 'demo' })}><FlaskConical size={15} />演示</button>
          <button type="button" aria-pressed={connection.mode === 'local'} onClick={() => updateConnection({ mode: 'local' })}><Laptop size={15} />本机</button>
          <button type="button" aria-pressed={connection.mode === 'remote'} onClick={() => updateConnection({ mode: 'remote' })}><Server size={15} />远程</button>
        </div>
        {connection.mode === 'demo' && <p className="mode-note">无需登录，不会读取文件或运行命令。</p>}
        {connection.mode === 'remote' && <div className="remote-fields">
          <label htmlFor="remote-url">Bridge 地址</label>
          <input id="remote-url" value={connection.url} onChange={(event) => updateConnection({ url: event.target.value })} placeholder="https://agent.example.com" inputMode="url" />
          <label htmlFor="remote-token">高级 Bridge 令牌</label>
          <input id="remote-token" type="password" value={connection.token} onChange={(event) => updateConnection({ token: event.target.value })} placeholder="PANEL_BRIDGE_TOKEN" autoComplete="off" />
        </div>}
        {connection.mode !== 'demo' && <button type="button" className={`test-connection ${connectionState}`} onClick={() => void testConnection()} disabled={connectionState === 'checking'}><Wifi size={15} />{connectionState === 'checking' ? '正在连接' : connectionState === 'online' ? '连接正常' : '测试连接'}</button>}
      </fieldset>

      {connection.mode !== 'demo' && <fieldset className="agent-fieldset">
        <legend>执行 Agent</legend>
        <div className="agent-options">{agentOptions.map((option) => {
          const state = providers.find((provider) => provider.id === option.id);
          const ready = state?.available && state.authenticated;
          const stateLabel = !state ? '等待检测' : !state.available ? '未安装' : !state.authenticated ? '未登录' : '可用';
          return <button type="button" key={option.id} aria-pressed={agentProvider === option.id} onClick={() => selectAgentProvider(option.id)} disabled={busy || Boolean(state && !ready)} title={state?.version || option.description}><Terminal size={16} /><span><strong>{option.label}</strong><small className={ready ? 'ready' : ''}>{stateLabel}</small></span></button>;
        })}</div>
      </fieldset>}

      {!pairingAdmin && <fieldset className="pairing-fieldset">
        <legend>连接这台电脑</legend>
        {pairedDevice ? <div className="paired-device"><ShieldCheck size={17} /><span><strong>已安全配对</strong><small>{pairedDevice.name}</small></span></div> : <div className="pair-code-entry"><input aria-label="一次性配对码" value={pairCode} onChange={(event) => setPairCode(event.target.value.toUpperCase())} placeholder="ABCD-EFGH" autoComplete="one-time-code" /><button type="button" onClick={() => void connectWithCode(pairCode)} disabled={pairingBusy || !pairCode.trim()}>{pairingBusy ? <RotateCw className="spin" size={16} /> : <Link2 size={16} />}配对</button></div>}
      </fieldset>}

      {pairingAdmin && <fieldset className="pairing-fieldset pairing-admin">
        <legend>手机配对</legend>
        <label htmlFor="public-url">手机访问的 HTTPS 地址</label>
        <input id="public-url" value={publicUrl} onChange={(event) => setPublicUrl(event.target.value)} placeholder="https://your-tunnel.example.com" inputMode="url" />
        <button type="button" className="create-pairing" onClick={() => void createPairingCode()} disabled={pairingBusy || !publicUrl.trim()}>{pairingBusy ? <RotateCw className="spin" size={16} /> : <Smartphone size={16} />}生成 10 分钟配对码</button>
        {pairingInfo && <div className="pairing-ticket">{pairingQr && <img src={pairingQr} alt="手机配对二维码" />}<div><strong>{pairingInfo.code}</strong><small>{new Date(pairingInfo.expiresAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })} 前有效，使用一次后失效</small></div></div>}
        <div className="paired-devices"><span>已授权设备</span>{devices.length ? devices.map((device) => <div key={device.id}><span><strong>{device.name}</strong><small>{new Date(device.lastSeenAt).toLocaleString('zh-CN')}</small></span><button type="button" onClick={() => void revokeDevice(device.id)} title="撤销设备" aria-label={`撤销 ${device.name}`}><Trash2 size={15} /></button></div>) : <p>暂无设备</p>}</div>
      </fieldset>}

      <fieldset className="layout-fieldset"><legend>面板结构</legend><div className="layout-options">{layouts.map((item) => <button type="button" key={item.id} className={`layout-option ${item.id}`} aria-pressed={layout === item.id} onClick={() => selectLayout(item.id)} title={item.description}><i aria-hidden="true"><span /><b>{Array.from({ length: item.previewKeys }, (_, index) => <em key={index} />)}</b></i><strong>{item.label}</strong></button>)}</div></fieldset>
      {layout === 'hardware-micro' && <fieldset className="micro-customizer">
        <legend>自定义键帽</legend>
        <div className="micro-customizer-heading"><span>COMMAND KEYS</span><button type="button" onClick={resetMicroKeys} title="恢复默认键帽"><RotateCcw size={14} />重置</button></div>
        <div className="micro-keycap-list">
          <span className="micro-preview-knob" title="旋钮" aria-label="旋钮"><RotateCw size={18} /></span>
          {Array.from({ length: 6 }, (_, index) => <span key={index} className={`micro-preview-agent slot-${index + 1}`}>{index + 1}</span>)}
          <span className="micro-preview-joystick" title="摇杆" aria-label="摇杆"><Plus size={18} /></span>
          {microKeys.map((key) => <button type="button" key={key.id} className={`micro-keycap-option micro-${key.id} micro-color-${key.color}`} aria-pressed={editingMicroKey === key.id} onClick={() => setEditingMicroKey(key.id)} title={`编辑 ${key.label}`} aria-label={`编辑键位 ${key.id}`}>{renderMicroIcon(key.icon, 19)}<span>{key.label || 'KEY'}</span></button>)}
          <span className="micro-preview-connection" title="连接触控区" aria-label="连接触控区"><i /></span>
        </div>
        {activeMicroKey && <div className="micro-key-editor">
          <label htmlFor="micro-key-label">键帽文字</label>
          <input id="micro-key-label" value={activeMicroKey.label} maxLength={12} onChange={(event) => updateMicroKey(activeMicroKey.id, { label: event.target.value.toUpperCase() })} />
          <label htmlFor="micro-key-action">按键动作</label>
          <select id="micro-key-action" value={activeMicroKey.action} onChange={(event) => updateMicroKey(activeMicroKey.id, { action: event.target.value as MicroActionId })}>{microActions.map((action) => <option key={action.id} value={action.id}>{action.label}</option>)}</select>
          {activeMicroKey.action === 'prompt' && <><label htmlFor="micro-key-prompt">快捷指令</label><textarea id="micro-key-prompt" rows={3} maxLength={1000} value={activeMicroKey.prompt} onChange={(event) => updateMicroKey(activeMicroKey.id, { prompt: event.target.value })} /></>}
          <span className="micro-editor-label">键帽图标</span>
          <div className="micro-icon-options">{microIconOptions.map((icon) => <button type="button" key={icon.id} aria-pressed={activeMicroKey.icon === icon.id} onClick={() => updateMicroKey(activeMicroKey.id, { icon: icon.id })} title={icon.label} aria-label={icon.label}>{renderMicroIcon(icon.id, 18)}</button>)}</div>
          <span className="micro-editor-label">灯光颜色</span>
          <div className="micro-color-options">{microColors.map((color) => <button type="button" key={color.id} className={`micro-color-${color.id}`} aria-pressed={activeMicroKey.color === color.id} onClick={() => updateMicroKey(activeMicroKey.id, { color: color.id })} title={color.label} aria-label={color.label}><i /></button>)}</div>
        </div>}
      </fieldset>}
      <fieldset className="theme-fieldset"><legend>外观配色</legend><div className="theme-options">{themes.map((item) => <button type="button" key={item.id} className={`theme-option ${item.id}`} aria-pressed={theme === item.id} onClick={() => selectTheme(item.id)} title={item.description}><i aria-hidden="true"><span /></i><strong>{item.label}</strong></button>)}</div></fieldset>
      {connection.mode !== 'demo' && <><label htmlFor="cwd">{connection.mode === 'remote' ? '远程工作目录' : '工作目录'}</label><input id="cwd" value={cwd} onChange={(event) => setCwd(event.target.value)} placeholder={connection.mode === 'remote' ? '/home/user/project' : 'C:\\path\\to\\project 或 /path/to/project'} /></>}
      <p className="privacy-note"><ShieldCheck size={14} />项目本身不收集任务、录音或代码。启用第三方 HTTPS Tunnel 时，流量还受该服务商的隐私条款约束。</p>
    </div>;
  }

  return (
    <div className={`app-shell layout-${layout} ${isPanelMode ? 'panel-mode' : ''}`} data-theme={theme}>
      <header className="topbar">
        <a className="brand" href="/" title="返回项目首页" aria-label="返回项目首页"><span className="brand-mark"><Sparkles size={17} /></span><span>VIBE PANEL</span><small>AGENT CONTROLLER</small></a>
        <div className="topbar-actions"><button className="connection" onClick={() => setShowSettings(true)} title={`${agentLabel} / Agent 连接设置`}><i className={connectionState} /><span>{connectionState === 'checking' ? 'CONNECTING' : connection.mode === 'demo' ? agentLabel : activeAgent.label.toUpperCase()}</span></button><button className="header-button" onClick={() => setShowHistory(true)}><History size={18} /><span>历史</span></button><button className="header-button primary" onClick={reset}><Plus size={18} /><span>新任务</span></button></div>
      </header>

      <main>
        <section className="intro"><div className="intro-index">VP / 01</div><div><p className="eyebrow">NO HARDWARE REQUIRED</p><h1>把 Agent，<br />握在手里。</h1></div><p className="intro-copy"><strong>无需购买外设。</strong>打开 App 就能语音下令、捕获屏幕和执行任务，直接体验完整的 Vibe Coding 控制面板。</p></section>

        <section className="console-zone" aria-label="Agent 控制台">
          <div className="device">
            <div className="device-rail"><span>{activeLayout.label.toUpperCase()}</span><div className="speaker-grill" aria-hidden="true">{Array.from({ length: 11 }, (_, index) => <i key={index} />)}</div><button type="button" className="panel-mode-button" onClick={() => void togglePanelMode()} title={isPanelMode ? '退出全屏控制器' : '全屏控制器'} aria-label={isPanelMode ? '退出全屏控制器' : '全屏控制器'}>{isPanelMode ? <Minimize2 size={17} /> : <Maximize2 size={17} />}</button><button className={`knob ${showSettings ? 'active' : ''}`} onClick={() => setShowSettings((open) => !open)} title="主题与工作目录" aria-label="设置主题与工作目录"><span /></button></div>

            <div className="display-bezel"><div className="display">
              <div className="display-main">
                <div className="display-status"><span className={`status-light ${status}`} /><span>{activeAgent.label.toUpperCase()} / {isRecoveringJob ? '恢复中' : statusLabels[status]}</span><div className="display-quick-actions"><button type="button" className="new-task-action" onClick={reset} disabled={busy || voiceBusy || isAddingContext || isRecoveringJob} title="新建任务" aria-label="新建任务"><Plus size={16} /></button><button type="button" className="context-action" onClick={() => imageInputRef.current?.click()} disabled={busy || voiceBusy || isAddingContext || isRecoveringJob} title="添加图片上下文" aria-label="添加图片上下文">{isAddingContext ? <RotateCw className="spin" size={16} /> : <ImagePlus size={16} />}</button><button type="button" className="history-action" onClick={() => setShowHistory(true)} title="任务记录" aria-label="任务记录"><History size={16} /></button></div><span className="display-time"><Clock3 size={13} /> {busy ? duration : 'READY'}</span></div>
                <div className={`display-content ${isListening ? 'listening' : ''}`}>
                  {capturePreview && !busy && !result ? <div className="capture-preview"><img src={capturePreview} alt="已添加的图片上下文" /><div><span>VISUAL CONTEXT</span><strong>图片已装载</strong></div><button type="button" onClick={() => { setCapturePath(''); setCapturePreview(''); }} aria-label="移除图片"><X size={16} /></button></div>
                    : result && !busy ? <div className="result-screen"><span className="screen-label">TASK COMPLETE</span><strong>{taskTitle}</strong><p>{result}</p><button onClick={async () => { await navigator.clipboard.writeText(result); setCopied(true); window.setTimeout(() => setCopied(false), 1500); }}>{copied ? <Check size={14} /> : <Copy size={14} />}{copied ? '已复制' : '复制结果'}</button></div>
                    : busy ? <div className="running-screen"><span className="screen-label">NOW RUNNING</span><strong>{taskTitle || '正在启动 Agent'}</strong><p>{latestProgress}</p><div className="progress-track"><i /></div></div>
                    : isRecoveringJob ? <div className="running-screen recovering-screen"><span className="screen-label">RESTORING SESSION</span><strong>正在恢复上次任务</strong><p>正在连接 Agent 并读取最新进度</p><div className="progress-track"><i /></div></div>
                    : <div className="command-screen">{isListening && <div className="waveform" aria-hidden="true">{Array.from({ length: 28 }, (_, index) => <i key={index} />)}</div>}<div className="screen-label">{isListening ? 'LISTENING' : isTranscribing ? 'TRANSCRIBING' : 'COMMAND DRAFT'}</div><label htmlFor="command">任务指令</label><textarea id="command" ref={promptRef} value={prompt} onChange={(event) => setPrompt(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void execute(); } }} rows={3} maxLength={3000} placeholder={isListening ? '正在录音，再按一次结束…' : isTranscribing ? '正在把语音转成文字…' : '按下语音键，或在这里输入…'} /></div>}
                </div>
                {layout === 'hardware-micro' && result && !busy && <textarea id="command" className="micro-followup" ref={promptRef} aria-label="继续当前任务" rows={2} value={prompt} maxLength={3000} placeholder={isListening ? '正在录音…' : isTranscribing ? '正在转写…' : '继续当前任务…'} onChange={(event) => setPrompt(event.target.value)} />}
                <div className="activity-strip">{recentActivity.length ? recentActivity.map((item) => <div key={item.id}><span>{item.type === 'tool' ? 'CMD' : item.type === 'status' ? 'SYS' : 'AI'}</span><p>{item.text}</p></div>) : <div><span>SYS</span><p>{capturePath ? '图片上下文已准备' : '等待输入'}</p></div>}</div>
              </div>
              <div className="display-side"><div className="counter"><strong>{Math.max(runningTaskCount, busy ? 1 : 0)}</strong><span>运行中</span></div><div className="counter"><strong>{completedTaskCount}</strong><span>已完成</span></div><button type="button" className="workspace-readout" onClick={openWorkspacePicker} disabled={busy} title="切换 Workspace"><Folder size={15} /><span>{connection.mode === 'remote' ? 'REMOTE WORKSPACE' : 'WORKSPACE'} / 点击切换</span><strong>{cwd.split(/[\\/]/).filter(Boolean).pop() || cwd || '/'}</strong></button><div className={`signal-bars ${connectionState}`} aria-label={`Agent ${connectionState === 'online' ? '连接正常' : '等待连接'}`}><i /><i /><i /><i /></div></div>
            </div></div>
            <input ref={imageInputRef} hidden type="file" accept="image/*" tabIndex={-1} aria-hidden="true" onChange={(event) => void addImageContext(event)} />
            <input ref={audioInputRef} hidden type="file" accept="audio/*" capture="user" tabIndex={-1} aria-hidden="true" onChange={(event) => void importAudioRecording(event)} />

            <form className="control-bank" onSubmit={execute}>
              {renderControlBank()}
            </form>

            <div className="device-footer"><span><Keyboard size={14} /> TEXT + VOICE</span><button type="button" className="theme-shortcut" onClick={() => setShowSettings(true)}><Palette size={14} /> PANEL / {activeLayout.label}</button></div>
            {showSettings && renderSettingsPopover()}
          </div>
          {error && <div className="error-banner"><Terminal size={16} /><span>{error}</span>{canImportRecording && <button type="button" className="audio-import-action" onClick={() => audioInputRef.current?.click()}><FileAudio size={15} />系统录音</button>}<button onClick={() => { setError(''); setCanImportRecording(false); }} aria-label="关闭"><X size={15} /></button></div>}
        </section>

        <section className="control-legend" aria-label="控制说明"><div><span>01</span><strong>说</strong><p>语音成为任务草稿</p></div><div><span>02</span><strong>看</strong><p>捕获当前屏幕上下文</p></div><div><span>03</span><strong>执行</strong><p>{activeAgent.label} 在项目中完成工作</p></div></section>
      </main>

      {showOnboarding && <div className="onboarding-backdrop" role="presentation"><section className="onboarding-card" role="dialog" aria-modal="true" aria-labelledby="onboarding-title">
        <div className="onboarding-heading"><div><span>FIRST RUN</span><h2 id="onboarding-title">先把电脑连上</h2></div><button type="button" onClick={() => dismissOnboarding()} aria-label="稍后设置"><X size={18} /></button></div>
        <p className="onboarding-copy">手机只是控制面板，Agent 和项目仍运行在你的电脑上。完成下面的检查后，就可以直接说话或输入任务。</p>
        <div className="onboarding-checks">
          <div className={connectionState === 'online' ? 'ready' : connectionState === 'checking' ? 'checking' : ''}><i>{connectionState === 'online' ? <Check size={15} /> : <Wifi size={15} />}</i><span><strong>连接状态</strong><small>{connectionState === 'online' ? '面板已连接' : connectionState === 'checking' ? '正在检测' : '等待连接'}</small></span></div>
          <div className={connection.mode === 'demo' || readyProviderCount > 0 ? 'ready' : ''}><i>{connection.mode === 'demo' || readyProviderCount > 0 ? <Check size={15} /> : <Terminal size={15} />}</i><span><strong>{connection.mode === 'demo' ? '演示模式' : '执行 Agent'}</strong><small>{connection.mode === 'demo' ? '不会修改电脑文件' : readyProviderCount ? `${readyProviderCount} 个 Agent 可用` : '尚未检测到已登录 Agent'}</small></span></div>
          <div className={cwd && cwd !== '.' ? 'ready' : ''}><i>{cwd && cwd !== '.' ? <Check size={15} /> : <Folder size={15} />}</i><span><strong>工作区</strong><small>{cwd && cwd !== '.' ? cwd : '稍后选择项目目录'}</small></span></div>
        </div>
        <div className="onboarding-actions"><button type="button" onClick={() => { updateConnection({ mode: 'demo' }); dismissOnboarding(); }}>先体验演示</button><button type="button" className="onboarding-primary" onClick={() => dismissOnboarding(true)}><Laptop size={16} />配置电脑连接</button></div>
        <div className={`onboarding-foot ${onboardingReady ? 'ready' : ''}`}>{onboardingReady ? '可以开始创建任务' : '连接完成后这里会显示“可以开始创建任务”'}</div>
      </section></div>}

      {showHistory && <div className="drawer-backdrop" onMouseDown={() => setShowHistory(false)}><aside className="history-drawer" onMouseDown={(event) => event.stopPropagation()}><div className="drawer-heading"><div><span>{connection.mode === 'local' ? 'NATIVE SESSIONS' : 'PANEL TASKS'}</span><h2>{connection.mode === 'local' && historySource === 'native' ? '原生会话' : '任务记录'}</h2></div><button className="icon-button" onClick={() => setShowHistory(false)} aria-label="关闭"><X size={20} /></button></div>{connection.mode === 'local' && <div className="history-tabs"><button className={historySource === 'native' ? 'active' : ''} onClick={() => setHistorySource('native')}>原生会话</button><button className={historySource === 'panel' ? 'active' : ''} onClick={() => setHistorySource('panel')}>Panel 任务</button></div>}{historySource === 'native' && connection.mode === 'local' ? <><div className="native-session-hint">按 Workspace 筛选 · {agentProvider === 'claude' ? 'Claude Code' : 'Codex'}<br />选择后可读取原生对话；接续前请先退出原终端。</div>{nativeError && <div className="history-error">{nativeError}</div>}<div className="history-list">{nativeLoading && !nativeList.length ? <div className="history-empty"><RotateCw className="spin" size={24} /><p>正在读取原生会话</p></div> : nativeList.length === 0 ? <div className="history-empty"><History size={26} /><p>当前 Workspace 没有会话</p></div> : nativeList.map((session) => <button key={session.id} onClick={() => chooseNativeSession(session)} className="history-item"><span className="history-status completed"><History size={13} /></span><span className="history-copy"><strong>{session.title}</strong><small>{new Date(session.updatedAt).toLocaleString('zh-CN')}<br />{session.id}</small></span></button>)}{nativeCursor && <button className="history-more" onClick={() => void moreNativeSessions()}>加载更多</button>}</div></> : <div className="history-list">{history.length === 0 ? <div className="history-empty"><History size={26} /><p>还没有任务</p></div> : history.map((job) => <button key={job.id} onClick={() => loadJob(job)} className="history-item"><span className={`history-status ${job.status}`}>{job.status === 'running' || job.status === 'queued' ? <RotateCw size={13} /> : job.status === 'completed' ? <Check size={13} /> : <CircleStop size={13} />}</span><span className="history-copy"><strong>{job.prompt}</strong><small>{statusLabels[job.status]} · {job.agentProvider === 'claude' ? 'Claude Code' : 'Codex'}<br />{job.cwd}<br />{new Date(job.createdAt).toLocaleString('zh-CN')}</small></span></button>)}</div>}</aside></div>}

      {nativeSelection && <div className="native-session-backdrop"><section className="native-session-dialog" role="dialog" aria-modal="true" aria-label="原生会话详情"><div className="drawer-heading"><div><span>{nativeSelection.provider === 'claude' ? 'CLAUDE CODE' : 'CODEX CLI'}</span><h2>{nativeSelection.title}</h2></div><button className="icon-button" disabled={busy} onClick={() => setNativeSelection(null)} aria-label="关闭"><X size={20} /></button></div><div className="native-session-messages">{nativeSelection.messages ? nativeSelection.messages.length ? nativeSelection.messages.map((message, index) => <div className={`native-message ${message.role}`} key={`${message.at}-${index}`}><span>{message.role === 'user' ? 'YOU' : 'AGENT'}</span><p>{message.text}</p></div>) : <p>会话没有可显示的文字消息</p> : <p>正在读取会话内容…</p>}</div><div className="native-session-hint">每 3 秒读取终端已保存的新消息。{nativeSelection.truncated && '仅展示部分历史。'}<br />{nativeSelection.canResume === false ? '终端仍占用会话：可查看，退出原 CLI 后才能接续。' : '接续完成后，在终端重新 resume 原会话以加载新消息。'}<br /><code>{nativeSelection.provider === 'claude' ? 'claude --resume' : 'codex resume'} {nativeSelection.id}</code></div>{(nativeError || error) && <div className="history-error" role="alert">{nativeError || error}</div>}<textarea className="native-session-input" aria-label="原生会话后续指令" value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder="输入后续指令，继续原来的会话…" disabled={busy} /><label className="native-release-check"><input type="checkbox" checked={terminalReleased} onChange={(event) => setTerminalReleased(event.target.checked)} /> 我已退出电脑上的原生终端会话，允许 Panel 接续</label><div className="native-session-actions"><button disabled={busy} onClick={() => { setNativeSelection(null); setShowHistory(true); }}>返回列表</button><button className="select-workspace" disabled={!terminalReleased || nativeSelection.canResume !== true || !prompt.trim() || busy || Boolean(nativeError)} onClick={() => void resumeNativeSession(prompt.trim())}>{busy ? '正在接续…' : '发送并接续原会话'}</button></div></section></div>}

      {showWorkspacePicker && <div className="workspace-backdrop" onMouseDown={() => setShowWorkspacePicker(false)}><section className="workspace-picker" role="dialog" aria-modal="true" aria-labelledby="workspace-picker-title" onMouseDown={(event) => event.stopPropagation()}><div className="workspace-picker-heading"><div><span>AGENT FILESYSTEM</span><h2 id="workspace-picker-title">切换 Workspace</h2></div><button type="button" onClick={() => setShowWorkspacePicker(false)} aria-label="关闭目录选择器"><X size={19} /></button></div><form className="workspace-path-form" onSubmit={(event) => { event.preventDefault(); void browseWorkspace(workspacePath.trim()); }}><input aria-label="目录路径" value={workspacePath} onChange={(event) => setWorkspacePath(event.target.value)} spellCheck={false} /><button type="submit" disabled={workspaceLoading || !workspacePath.trim()} aria-label="打开输入的目录" title="打开目录">{workspaceLoading ? <RotateCw className="spin" size={17} /> : <ChevronRight size={17} />}</button></form><div className="workspace-browser-toolbar"><button type="button" onClick={() => workspaceParent && void browseWorkspace(workspaceParent)} disabled={!workspaceParent || workspaceLoading}><ArrowUp size={16} />上一级</button><span>{connection.mode === 'remote' ? 'REMOTE' : 'LOCAL'}</span></div><div className="workspace-directory-list">{workspaceError ? <div className="workspace-browser-empty error"><Terminal size={20} /><p>{workspaceError}</p></div> : workspaceLoading ? <div className="workspace-browser-empty"><RotateCw className="spin" size={21} /><p>正在读取目录</p></div> : workspaceDirectories.length ? workspaceDirectories.map((directory) => <button type="button" key={directory.path} onClick={() => void browseWorkspace(directory.path)}><FolderOpen size={17} /><span>{directory.name}</span><ChevronRight size={15} /></button>) : <div className="workspace-browser-empty"><Folder size={21} /><p>这个目录没有子目录</p></div>}</div><div className="workspace-picker-actions"><button type="button" onClick={() => setShowWorkspacePicker(false)}>取消</button><button type="button" className="select-workspace" onClick={selectWorkspace} disabled={workspaceLoading || Boolean(workspaceError) || !workspaceResolvedPath || workspacePath.trim() !== workspaceResolvedPath}><Check size={16} />选择当前目录</button></div></section></div>}

      <footer><span>VIBE PANEL / 2026</span><span>BREAK THE KEYBOARD. JUST BUILD.</span></footer>
    </div>
  );
}

function LandingPage() {
  return <div className="site-shell">
    <header className="site-nav"><a className="site-brand" href="/"><span className="site-mark"><Sparkles size={16} /></span><span>VIBE PANEL</span></a><nav><a href="#how-it-works">怎么工作</a><a href="/download">下载 Connector</a><a className="site-nav-action" href="/app">打开面板 <ChevronRight size={15} /></a></nav></header>
    <main>
      <section className="site-hero"><div className="site-hero-copy"><p className="site-kicker">A CONTROL SURFACE FOR YOUR AGENT</p><h1>把 Agent，<br /><em>握在手里。</em></h1><p>不用买外设。用手机的语音和几个关键按键，控制电脑上的 Codex 或 Claude Code。</p><div className="site-hero-actions"><a className="site-primary-action" href="/app">打开控制面板 <ArrowRight size={17} /></a><a className="site-secondary-action" href="/download">下载电脑 Connector</a></div><span className="site-note"><ShieldCheck size={14} />任务、代码和录音留在你的电脑上</span></div><div className="site-hero-device"><div className="site-device-label">VIBE PANEL / CODEX MICRO</div><img src="/screenshots/runtime/panel-desktop.png" alt="Vibe Panel 控制面板运行截图" /></div></section>
      <section className="site-proof"><div><strong>01</strong><span>说</span><p>按住语音键，说出你的想法</p></div><div><strong>02</strong><span>看</span><p>添加屏幕或图片上下文</p></div><div><strong>03</strong><span>做</span><p>Agent 在你的项目里完成任务</p></div></section>
      <section className="site-how" id="how-it-works"><div><p className="site-kicker">THREE STEPS</p><h2>从打开到完成，<br />只需要一条连接。</h2></div><div className="site-steps"><div><b>1</b><strong>在电脑启动 Connector</strong><p>macOS 或 Windows 双击启动文件，自动检测 Agent、Whisper 和 ffmpeg。</p></div><div><b>2</b><strong>手机打开配对链接</strong><p>Connector 会生成一次性链接，不需要注册账号。</p></div><div><b>3</b><strong>选择项目，开始下令</strong><p>选择 Codex 或 Claude Code，然后用语音或文字创建任务。</p></div></div></section>
      <section className="site-cta"><p className="site-kicker">READY WHEN YOU ARE</p><h2>先在浏览器里试一次。</h2><p>演示模式不会读取文件，也不会运行命令。</p><a className="site-primary-action" href="/app">进入 Vibe Panel <ArrowRight size={17} /></a></section>
    </main>
    <footer className="site-footer"><span>VIBE PANEL / 2026</span><span><a href="/download">下载</a><a href="https://github.com/x2v-co/vibe-coding-panel">GitHub</a></span></footer>
  </div>;
}

function DownloadPage() {
  return <div className="site-shell download-shell">
    <header className="site-nav"><a className="site-brand" href="/"><span className="site-mark"><Sparkles size={16} /></span><span>VIBE PANEL</span></a><nav><a href="/">项目介绍</a><a className="site-nav-action" href="/app">打开面板 <ChevronRight size={15} /></a></nav></header>
    <main className="download-main"><div className="download-heading"><p className="site-kicker">GET STARTED ON DESKTOP</p><h1>下载 Connector。</h1><p>Connector 运行在你的电脑上，把手机面板安全地连接到本机的 Codex 或 Claude Code。</p></div><div className="download-card"><div className="download-card-icon"><Laptop size={24} /></div><div><h2>Vibe Panel Connector</h2><p>支持 macOS、Windows 10/11 和 Linux · 需要 Node.js 24 LTS</p><a className="site-primary-action" href="https://github.com/x2v-co/vibe-coding-panel/archive/refs/heads/main.zip">下载 Connector ZIP <ArrowRight size={17} /></a></div></div><div className="download-guide"><h2>三步开始</h2><ol><li><b>下载并解压</b><span>先安装 Node.js 24 LTS，并确认 Codex 或 Claude Code 已登录且能正常回复。</span></li><li><b>启动 Connector</b><span>macOS 双击 <code>Vibe Panel.command</code>；Windows 双击 <code>Vibe Panel.bat</code>；Linux 运行 <code>npm install</code> 后再运行 <code>npm run connect</code></span></li><li><b>手机扫描二维码</b><span>等待终端显示已连接，用手机相机扫描二维码。保持窗口运行和电脑唤醒。</span></li></ol></div><div className="download-help"><ShieldCheck size={17} /><span><a href="https://github.com/x2v-co/vibe-coding-panel/blob/main/README.zh-CN.md">完整安装说明</a> · <a href="https://github.com/x2v-co/vibe-coding-panel/blob/main/docs/install-for-agents.md">让 Agent 安装</a> · 还没安装 Agent？<a href="/app">先用演示模式体验</a>。</span></div></main>
    <footer className="site-footer"><span>VIBE PANEL / 2026</span><span><a href="/">项目介绍</a><a href="/app">打开面板</a></span></footer>
  </div>;
}

function App() {
  const url = new URL(window.location.href);
  const isPanelRoute = url.pathname === '/app' || url.pathname.startsWith('/app/') || url.searchParams.has('relay') || url.searchParams.has('pair');
  if (url.pathname === '/download') return <DownloadPage />;
  if (!isPanelRoute && url.pathname === '/') return <LandingPage />;
  return <PanelApp />;
}

export default App;
