import {
  ArrowUp, ArrowDown, ArrowLeft, ArrowRight, BrainCircuit, Camera, Check, ChevronRight, CircleCheck, CircleX, CircleStop, Clock3, Copy, Folder, FolderOpen, Grid2X2, History, Split,
  FileAudio, FlaskConical, ImagePlus, Keyboard, Laptop, Link2, Maximize2, Mic, MicOff, Minimize2,
  MessageCircle, Palette, Play, Plus, RotateCcw, RotateCw, Send, Server, ShieldCheck,
  Smartphone, Sparkles, Terminal, Trash2, Wifi, X, Zap,
} from 'lucide-react';
import { MicroSettings, MicroActionOptions } from './MicroSettings';
import { readMicroPreferences, microDirections, microDragDirection, microSlots, microTaskState, microTaskVersion } from './micro';
import type { MicroPreferences, MicroBinding, MicroDirection } from './micro';
import QRCode from 'qrcode';
import { readApiResponse, userError } from './api';
import { monitorConnection } from './connection-monitor';
import { MIN_RECORDING_MS, recordingMimeTypes, validateRecording } from './recording';
import { Fragment, ChangeEvent, FormEvent, useEffect, useMemo, useRef, useState } from 'react';
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
type RuntimeDiagnostics = { connector: { version: string; revision: string | null; distribution: string }; node: string; platform: string; arch: string; providers: AgentProviderInfo[]; speech: { backend: string; model: string; whisper: { status: string; version: string | null }; ffmpeg: { status: string; version: string | null }; correction: string; guidance?: string } };
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
type NativeSession = { id: string; provider: AgentProviderId; cwd: string; title: string; updatedAt: number; status?: string; canResume?: boolean; canRelease?: boolean; truncated?: boolean; messages?: { role: string; text: string; at: number }[] };

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
  useEffect(() => {
    const viewport = window.visualViewport;
    const root = document.documentElement;
    const update = () => {
      // Pinch zoom must not reflow the controller underneath the gesture.
      if (viewport && Math.abs(viewport.scale - 1) > 0.01) return;
      root.style.setProperty("--panel-visible-height", `${viewport?.height ?? window.innerHeight}px`);
    };
    update();
    viewport?.addEventListener("resize", update);
    window.addEventListener("resize", update);
    window.addEventListener("pageshow", update);
    return () => {
      viewport?.removeEventListener("resize", update);
      window.removeEventListener("resize", update);
      window.removeEventListener("pageshow", update);
      root.style.removeProperty("--panel-visible-height");
    };
  }, []);

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
  const [nativeDetailsOpen, setNativeDetailsOpen] = useState(false);
  const [confirmNativeRelease, setConfirmNativeRelease] = useState(false);
  const [nativeError, setNativeError] = useState('');
  const [nativeHandoff, setNativeHandoff] = useState<{ key: string; state: 'releasing' | 'released' | 'timeout' | 'error'; message: string } | null>(null);
  const nativeReleasePendingRef = useRef(false);
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
  const [connectionNotice, setConnectionNotice] = useState('');
  const [agentLabel, setAgentLabel] = useState('LOCAL AGENT');
  const [runtimeDiagnostics, setRuntimeDiagnostics] = useState<RuntimeDiagnostics | null>(null);
  const [diagnosticsError, setDiagnosticsError] = useState('');
  const [connectorRevision, setConnectorRevision] = useState<string | null>(null);
  const [agentProvider, setAgentProvider] = useState<AgentProviderId>(readAgentProvider);
  const [providers, setProviders] = useState<AgentProviderInfo[]>([]);
  const [microKeys, setMicroKeys] = useState<MicroKeyConfig[]>(readMicroKeys);
  const [editingMicroKey, setEditingMicroKey] = useState<MicroKeyId | null>(null);
  const [microPreferences, setMicroPreferences] = useState<MicroPreferences>(() => { try { return readMicroPreferences(JSON.parse(localStorage.getItem('vibe-panel-micro-preferences') || '{}')); } catch { return readMicroPreferences(null); } });
  const [microRead, setMicroRead] = useState<Record<string,string>>(() => { try { const v=JSON.parse(localStorage.getItem('vibe-panel-micro-read') || '{}'); return v && typeof v==='object' && !Array.isArray(v) ? v : {}; } catch { return {}; } });
  const pendingMicroSlot = useRef<number | null>(null);
  const joystickDrag = useRef<{x:number;y:number;fired:boolean}|null>(null);
  const [dialAngle,setDialAngle] = useState(0);
  const joystickFeedbackTimer = useRef<ReturnType<typeof setTimeout>|null>(null);
  const [joystickDirection,setJoystickDirection] = useState<MicroDirection|null>(null);
  const knobDrag = useRef<{y:number;moved:boolean}|null>(null);
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
  const nativeSelectionRef = useRef<NativeSession | null>(null);
  const jobRevisionRef = useRef(0);
  const jobMutationRef = useRef(0);

  function selectJob(id: string | null) {
    selectedJobRef.current = id;
    jobRevisionRef.current = 0;
    jobMutationRef.current += 1;
    setJobId(id);
    if (id && pendingMicroSlot.current !== null) {
      const slot = pendingMicroSlot.current;
      pendingMicroSlot.current = null;
      setMicroPreferences(p => ({...p, assignments:p.assignments.map((old,i)=>i===slot?id:old)}));
    }
  }

  const busy = status === 'queued' || status === 'running';
  const voiceBusy = isPreparingVoice || isListening || isFinalizingVoice || isTranscribing;
  const selectedHandoff = nativeSelection && nativeHandoff?.key === `${nativeSelection.provider}:${nativeSelection.id}` ? nativeHandoff : null;
  const canExecute = Boolean(prompt.trim() || capturePath) && !busy && !voiceBusy && !isAddingContext && !isRecoveringJob && selectedHandoff?.state !== 'releasing';
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
  const microTasks = [...(currentMicroJob ? [{...history.find(j=>j.id===jobId), ...currentMicroJob, revision:jobRevisionRef.current || history.find(j=>j.id===jobId)?.revision, finishedAt:history.find(j=>j.id===jobId)?.finishedAt}] : []), ...history.filter(j=>j.id!==jobId)];
  const microTaskSlots = microSlots(microTasks,microPreferences,microRead);
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
        const payload = await readApiResponse(response);
        if (!response.ok) throw new Error(payload.error || '请更新电脑 Connector 后重试');
        if (cancelled) return;
        setNativeList(payload.sessions || []); setNativeCursor(payload.nextCursor || null); setNativeError('');
      } catch (error) { if (!cancelled) setNativeError(userError(error, '无法读取会话')); }
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
      const payload = await readApiResponse(response); if (!response.ok) throw new Error(payload.error);
      setNativeList(items => [...items, ...(payload.sessions || []).filter((s: NativeSession) => !items.some(i => i.id === s.id))]);
      setNativeCursor(payload.nextCursor || null);
    } catch (error) { setNativeError(userError(error, '无法读取会话')); }
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
        const payload = await readApiResponse(response);
        if (!response.ok) throw new Error(payload.error);
        if (!cancelled) { setNativeSelection(payload); setNativeError(''); }
      } catch (error) { if (!cancelled) setNativeError(userError(error, '无法刷新原生会话')); }
      finally { pending = false; }
    };
    void refresh(); const timer = window.setInterval(() => { void refresh(); }, 3000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [nativeSelection?.id, nativeSelection?.provider, connection.mode]);

  function chooseNativeSession(session: NativeSession) {
    setShowHistory(false);
    if (busy || voiceBusy || isRecoveringJob) return;
    selectJob(null); setStatus('idle'); setResult(''); setActivity([]); setPrompt('');
    nativeSelectionRef.current = session;
    setNativeSelection(session); setNativeHandoff(null); setNativeDetailsOpen(false); setConfirmNativeRelease(false); setTaskTitle(session.title);
    // A saved session is safe for Connector handoff. Keep the explicit release
    // checkbox only for sessions that are currently attached to a terminal.
    setTerminalReleased(true); setNativeError(''); setShowHistory(false);
    localStorage.removeItem(ACTIVE_JOB_KEY);
  }

  async function resumeNativeSession(command: string) {
    const session = nativeSelection || nativeSelectionRef.current;
    if (!session) { setError('请先从任务记录选择一个原生会话'); return; }
    
    setStatus('queued'); setError('');
    try {
      const response = await fetch(`/api/native-sessions/${session.provider}/${session.id}/resume`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: command, cwd: session.cwd, terminalReleased }),
      });
      const payload = await readApiResponse(response); if (!response.ok) throw new Error(payload.error);
      setTaskTitle(session.title); nativeSelectionRef.current = null; setNativeSelection(null); setPrompt(''); setResult(''); setActivity([]);
      setCapturePath(''); setCapturePreview(''); setStartedAt(Date.now()); selectJob(payload.id);
      localStorage.setItem(ACTIVE_JOB_KEY, payload.id);
    } catch (error) { setStatus('idle'); setError(userError(error, '无法接续会话')); }
  }

  async function releaseNativeTerminal() {
    const session = nativeSelection || nativeSelectionRef.current;
    if (!session || nativeReleasePendingRef.current) return;
    const key = `${session.provider}:${session.id}`;
    nativeReleasePendingRef.current = true;
    setConfirmNativeRelease(false);
    setNativeHandoff({ key, state: 'releasing', message: '正在等待电脑终端退出…' });
    try {
      const response = await fetch(`/api/native-sessions/${session.provider}/${session.id}/release`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cwd: session.cwd }),
        signal: AbortSignal.timeout(25000),
      });
      const payload = await readApiResponse(response);
      if (!response.ok || !payload.released || !payload.session?.canResume) {
        setNativeHandoff({ key, state: payload.state === 'timeout' ? 'timeout' : 'error', message: payload.error || '终端尚未释放，请在电脑退出 CLI 后重试' });
        return;
      }
      setNativeHandoff({ key, state: 'released', message: '终端已释放，可以继续此会话' });
      setNativeSelection(current => current?.id === session.id && current.provider === session.provider ? payload.session : current);
    } catch (reason) {
      setNativeHandoff({ key, state: reason instanceof DOMException && reason.name === 'TimeoutError' ? 'timeout' : 'error', message: '交接未确认完成，请检查电脑终端状态后重试' });
    } finally { nativeReleasePendingRef.current = false; }
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
      const payload = await readApiResponse(response);
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
      if (!quiet) setError(userError(reason, '配对失败'));
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
      const payload = await readApiResponse(response);
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
      const payload = await readApiResponse(response);
      if (!response.ok) throw new Error(payload.error || '无法生成配对码');
      setPairingInfo(payload);
      setPairingQr(await QRCode.toDataURL(payload.pairingUrl, { width: 280, margin: 1, errorCorrectionLevel: 'M' }));
    } catch (reason) {
      setError(userError(reason, '无法生成配对码'));
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
      const payload = await readApiResponse(response);
      if (!response.ok) throw new Error(payload.error || 'Agent 连接失败');
      updateProviders(payload.providers || []);
      setConnectionState('online');
      setAgentLabel(connection.mode === 'remote' ? payload.name || 'REMOTE AGENT' : 'LOCAL AGENT');
    } catch (reason) {
      setConnectionState('offline');
      setError(userError(reason, 'Agent 连接失败'));
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
    setMicroPreferences(p=>({...p,joystick:readMicroPreferences(null).joystick}));
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
  useEffect(()=>{const escape=(event:KeyboardEvent)=>{if(event.key==='Escape'&&knobIndex!==null)cancelMicroKnob();};window.addEventListener('keydown',escape);return()=>window.removeEventListener('keydown',escape);},[knobIndex]);
  useEffect(()=>{ localStorage.setItem('vibe-panel-micro-preferences',JSON.stringify(microPreferences)); },[microPreferences]);
  useEffect(()=>{
    if(!jobId?.startsWith('demo-') || !result)return;
    const task=history.find(t=>t.id===jobId);
    if(task?.result===result)markMicroRead(task);
  },[jobId,result,history]);
  function markMicroRead(task:SavedJob) {
    if(task.status!=='completed' || !task.result || document.hidden)return;
    const version=microTaskVersion(task);
    setMicroRead(old=>{if(old[task.id]===version)return old;const next={...old,[task.id]:version};localStorage.setItem('vibe-panel-micro-read',JSON.stringify(next));return next;});
  }

  useEffect(() => {
    if (layout !== 'hardware-micro' || knobIndex === null) return;
    const target = composerElements()[knobIndex];
    target?.scrollIntoView({block:'nearest'});
    target?.classList.add('micro-knob-target');
    return () => target?.classList.remove('micro-knob-target');
  }, [knobIndex, layout, result, capturePreview, busy]);

  useEffect(() => {
    if (layout !== 'hardware-micro') return;
    const cancel = () => { cancelMicroVoice(); if(joystickFeedbackTimer.current)clearTimeout(joystickFeedbackTimer.current); joystickDrag.current=null; setJoystickDirection(null); if (knobHoldTimerRef.current) clearTimeout(knobHoldTimerRef.current); };
    const hidden = () => { if (document.hidden) cancel(); };
    window.addEventListener('blur', cancel);
    document.addEventListener('visibilitychange', hidden);
    return () => { window.removeEventListener('blur', cancel); document.removeEventListener('visibilitychange', hidden); cancel(); };
  }, [layout]);

  useEffect(() => {
    if (!showSettings || connection.mode !== 'local') return;
    const abort = new AbortController();
    const timer = window.setTimeout(() => { setDiagnosticsError('诊断超时，请稍后重新打开设置，文字输入不受影响'); abort.abort(); }, 15000);
    setRuntimeDiagnostics(null); setDiagnosticsError('');
    void fetch('/api/diagnostics', { signal: abort.signal }).then(async response => {
      if (!response.ok) throw new Error(response.status === 404 ? '电脑 Connector 版本较旧，请更新后重启' : '暂时无法读取诊断，请检查电脑连接后重试');
      const data = await readApiResponse(response) as RuntimeDiagnostics;
      if (!data.connector || !data.speech || !Array.isArray(data.providers)) throw new Error('诊断格式不兼容，请更新电脑 Connector');
      if (!abort.signal.aborted) { setRuntimeDiagnostics(data); setConnectorRevision(data.connector.revision); }
    }).catch(error => { if (!abort.signal.aborted) setDiagnosticsError(error.message); })
      .finally(() => window.clearTimeout(timer));
    return () => { window.clearTimeout(timer); abort.abort(); };
  }, [showSettings, connection.mode]);

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
        const payload = await readApiResponse(response);
        if (!response.ok) throw new Error(payload.error || '无法连接控制面板');
        setConnectorRevision(payload.connector?.revision || null);
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
        setError(userError(reason, '无法连接控制面板'));
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
    if (!authReady || connection.mode === 'demo') { setConnectionNotice(''); return; }
    return monitorConnection({
      load: async signal => {
        const response = await fetch('/api/jobs', { signal, cache: 'no-store' });
        const payload = await readApiResponse(response) as { jobs?: SavedJob[] };
        if (!response.ok || !Array.isArray(payload.jobs)) throw new Error('无法读取电脑任务状态');
        return payload.jobs;
      },
      onState: (state, reason) => {
        setConnectionState(state);
        setConnectionNotice(state === 'online' ? '' : state === 'checking' ? '网络已恢复，正在重新连接电脑…'
          : !navigator.onLine ? '手机网络已断开，恢复网络后将自动重连。原任务结果已保留。'
          : reason ? userError(reason, '与电脑的连接中断，正在自动重连。请勿重复发送任务。')
          : '与电脑的连接中断，正在自动重连。请勿重复发送任务。');
      },
      onData: jobs => {
        // Keep the Connector authoritative without changing selection or drafts.
        setHistory(jobs);
        const selected = selectedJobRef.current && jobs.find(job => job.id === selectedJobRef.current);
        if (selected && selected.revision !== undefined && selected.revision >= jobRevisionRef.current) {
          jobRevisionRef.current = selected.revision;
          setStatus(selected.status);
          if (selected.startedAt) setStartedAt(selected.startedAt);
          if (['completed', 'failed', 'stopped'].includes(selected.status)) void refreshJob(selected.id);
        }
      },
    });
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
        const payload = await readApiResponse(response);
        if (!response.ok) throw new Error(payload.error || '无法恢复上次任务');
        restoreJob(payload as SavedJob);
      } catch (reason) {
        setError(userError(reason, '无法恢复上次任务'));
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
      const job = await readApiResponse(response) as SavedJob;
      if (selectedJobRef.current !== id || jobMutationRef.current !== mutation) return;
      if (job.revision !== undefined && job.revision < jobRevisionRef.current) return;
      jobRevisionRef.current = job.revision || 0;
      setError((current) => current === '实时连接中断，正在自动恢复进度' ? '' : current);
      setStatus(job.status);
      setActivity(Array.isArray(job.events) ? job.events : []);
      setResult(job.result || '');
      markMicroRead(job);
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
    markMicroRead(job);
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
    const selectedNative = nativeSelection || nativeSelectionRef.current;
    if (selectedNative) { if (!nativeSelection) setNativeSelection(selectedNative); await resumeNativeSession(command); return; }
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
      const payload = await readApiResponse(response);
      if (!response.ok) throw new Error(payload.error || '任务启动失败');
      setTaskTitle(title);
      setPrompt(''); setCapturePath(''); setCapturePreview(''); selectJob(payload.id);
      localStorage.setItem(ACTIVE_JOB_KEY, payload.id);
    } catch (reason) {
      setStatus('failed');
      setStartedAt(null);
      setError(userError(reason, '任务启动失败'));
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
      const payload = await readApiResponse(response);
      if (!response.ok) throw new Error(payload.error || '无法继续任务');
      setPrompt(''); setCapturePath(''); setCapturePreview(''); setActivity([]); setResult('');
      setStreamVersion((version) => version + 1);
    } catch (reason) {
      setStatus('failed');
      setError(userError(reason, '无法继续任务'));
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
    const stoppingJobId = jobId;
    try {
      const response = await fetch(`/api/jobs/${stoppingJobId}/stop`, {
        method: 'POST', signal: AbortSignal.timeout(10000),
      });
      const payload = await readApiResponse(response);
      if (!response.ok) throw new Error(payload.error || '无法停止任务');
      await refreshJob(stoppingJobId);
    } catch (reason) {
      if (selectedJobRef.current === stoppingJobId) setError(userError(reason, '停止请求未确认，请检查任务状态后重试'));
    }
  }

  function reset() {
    pendingMicroSlot.current=null;
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
    if (!(reason instanceof DOMException)) return userError(reason, '无法启动麦克风');
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
      const payload = await readApiResponse(response);
      if (!response.ok) throw new Error(payload.error || '录音转写失败');
      if (voiceSession !== voiceSessionRef.current) return;
      const transcript = String(payload.text || '').trim();
      if (!transcript) throw new Error('没有识别到语音，请靠近麦克风后重试');
      // Preserve edits made while transcription/correction was in flight.
      setPrompt(current => [current.trim(), transcript].filter(Boolean).join(' '));
    } catch (reason) {
      if (voiceSession === voiceSessionRef.current) {
        setCanImportRecording(true);
        setError(userError(reason, '录音转写失败'));
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
            setError(userError(error, '录音无法读取，请重试'));
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
      const payload = await readApiResponse(response);
      if (!response.ok) throw new Error(payload.error || '无法读取该目录');
      setWorkspacePath(payload.path);
      setWorkspaceResolvedPath(payload.path);
      setWorkspaceParent(payload.parent || null);
      setWorkspaceDirectories(Array.isArray(payload.directories) ? payload.directories : []);
    } catch (reason) {
      setWorkspaceResolvedPath('');
      setWorkspaceDirectories([]);
      setWorkspaceError(userError(reason, '无法读取该目录'));
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
    const payload = await readApiResponse(response);
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
      setError(userError(reason, '无法添加图片'));
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
      else setError(userError(reason, '屏幕捕获失败'));
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
    pendingMicroSlot.current=null;
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

  function triggerMicroAction(key: MicroBinding) {
    const unavailable = unavailableMicroAction(key.action);
    if (unavailable) { setError(unavailable); return; }
    if (microActionDisabled(key)) return;
    if (key.action === 'voice') void toggleSpeech();
    else if (key.action === 'execute') void execute();
    else if (key.action === 'stop') void stop();
    else if (key.action === 'new') reset();
    else if (key.action === 'back') navigateMicro(-1);
    else if (key.action === 'forward') navigateMicro(1);
    else if (key.action === 'sidebar') setShowHistory(open=>!open);
    else if (key.action === 'history') setShowHistory(true);
    else if (key.action === 'workspace') openWorkspacePicker();
    else if (key.action === 'capture') addVisualContext();
    else if (key.action === 'fullscreen') void togglePanelMode();
    else if (key.action === 'settings') setShowSettings(true);
    else if (key.action === 'prompt') { setPrompt(key.prompt.trim()); promptRef.current?.focus(); }
  }

  function microActionDisabled(key: MicroBinding) {
    if (unavailableMicroAction(key.action)) return true;
    if (key.action === 'back' && microNavigationIndex <= 0) return true;
    if (key.action === 'forward' && microNavigationIndex >= microNavigation.length-1) return true;
    if (key.action === 'stop') return !busy;
    if (key.action === 'execute') return !canExecute;
    if (key.action === 'voice') return busy || isFinalizingVoice || isTranscribing || isAddingContext || isRecoveringJob;
    if (key.action === 'sidebar' || key.action === 'history' || key.action === 'fullscreen' || key.action === 'settings') return false;
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

  function composerElements() {
    return ['#command','.context-action','.workspace-readout'].flatMap(selector=>Array.from(document.querySelectorAll<HTMLButtonElement|HTMLTextAreaElement>(selector))).filter(e=>!e.disabled&&e.getBoundingClientRect().height>0);
  }
  function cancelMicroKnob() {
    setKnobIndex(null); setShowWorkspacePicker(false); setShowHistory(false);
    if(document.activeElement instanceof HTMLElement) document.activeElement.blur();
  }
  function turnMicroKnob(direction: number) {
    setDialAngle(angle=>angle+direction*30);
    if(microPreferences.knobMode==='custom') { triggerMicroAction(microPreferences.knob[direction>0?'right':'left']); return; }
    if(microPreferences.knobMode==='scroll') { const area=document.querySelector('.layout-hardware-micro .display-main'); area?.scrollBy({top:direction*80}); return; }
    const targets=composerElements();
    if(targets.length) setKnobIndex(index=>((index??(direction>0?-1:0))+direction+targets.length)%targets.length);
  }
  function selectMicroKnob() {
    if (knobHeldRef.current) { knobHeldRef.current = false; return; }
    if(microPreferences.knobMode==='custom') { triggerMicroAction(microPreferences.knob.press); return; }
    if(microPreferences.knobMode==='scroll') { const area=document.querySelector('.layout-hardware-micro .display-main'); area?.scrollTo({top:area.scrollHeight}); return; }
    const target=composerElements()[knobIndex??0];
    if(!target)return;
    setKnobIndex(knobIndex??0);
    if(target instanceof HTMLTextAreaElement)target.focus();else target.click();
  }
  function holdMicroKnob() { if(microPreferences.knobMode==='custom')triggerMicroAction(microPreferences.knob.hold);else setShowSettings(true); }
  function fireMicroJoystick(direction:MicroDirection) {
    setJoystickDirection(direction);
    if(joystickFeedbackTimer.current)clearTimeout(joystickFeedbackTimer.current);
    joystickFeedbackTimer.current=setTimeout(()=>{if(!joystickDrag.current)setJoystickDirection(null);},180);
    triggerMicroAction(microPreferences.joystick[direction]);
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
    const slotState = microTaskState(task,microRead);
    const title = task ? `${statusLabels[task.status]} · ${task.prompt}` : '空任务槽 · 新建任务';
    const cancel = index === 0 && knobIndex !== null;
    return <button type="button" key={`agent-${index}`} className={`micro-agent-key slot-${index + 1} ${slotState} ${task?.id === jobId ? 'selected' : ''} ${cancel ? 'cancel' : ''}`} disabled={!cancel && (busy || voiceBusy || isRecoveringJob || isAddingContext)} onClick={() => { if (cancel) { cancelMicroKnob(); return; } if(task)loadJob(task);else { reset(); pendingMicroSlot.current=microPreferences.agentMode==='custom'?index:null; } }} title={cancel ? '取消旋钮选择' : title} aria-label={cancel ? '取消旋钮选择' : `任务槽 ${index + 1}：${title}`}><i /><span>{index + 1}</span></button>;
  }

  function renderMicroCommandKey(key: MicroKeyConfig) {
    const voice = key.action === 'voice';
    const unavailable = unavailableMicroAction(key.action);
    const label = `${key.label} · ${unavailable || microActions.find((action) => action.id === key.action)?.label || ''}`;
    return <button type="button" key={key.id} className={`micro-command-key micro-${key.id} micro-color-${key.color} ${voice && isListening ? 'listening' : ''} ${voice && (isPreparingVoice || isFinalizingVoice || isTranscribing) ? 'transcribing' : ''} ${voice && !voiceBusy && prompt.trim() ? 'draft-ready' : ''} ${unavailable ? 'unavailable' : ''}`}
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
    return <button type="button" className={`console-key voice-key ${isListening ? 'listening' : ''} ${className}`} onClick={shouldApprove ? () => void execute() : toggleSpeech} disabled={busy || isPreparingVoice || isFinalizingVoice || isTranscribing}>{shouldApprove ? <Check size={29} /> : isListening ? <MicOff size={31} /> : isPreparingVoice || isFinalizingVoice || isTranscribing ? <RotateCw className="spin" size={31} /> : <Mic size={31} />}<span>{shouldApprove ? 'APPROVE' : isListening ? 'LISTENING' : isPreparingVoice ? 'STARTING' : isFinalizingVoice ? 'PROCESSING' : isTranscribing ? 'TRANSCRIBING' : approve ? 'VOICE APPROVE' : 'VOICE INPUT'}</span><small>{shouldApprove ? '批准执行' : isListening ? '再次按下结束' : isPreparingVoice ? '正在打开麦克风' : isFinalizingVoice ? '正在完成录音' : isTranscribing ? '正在转写与校对' : '点按开始'}</small></button>;
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
      <div className="micro-control-knob" role="group" aria-label={`旋钮：${microPreferences.knobMode==='composer'?'编辑器导航':microPreferences.knobMode==='scroll'?'对话滚动':'自定义分配'}`} onKeyDown={event=>{ if(event.key==='Escape')cancelMicroKnob(); if(event.key==='ArrowLeft'||event.key==='ArrowRight'){event.preventDefault();turnMicroKnob(event.key==='ArrowRight'?1:-1);} }} onWheel={(event) => { if(event.deltaY)turnMicroKnob(event.deltaY > 0 ? 1 : -1); }}>
        <button type="button" className="knob-left" onClick={() => turnMicroKnob(-1)} title="逆时针：上一项" aria-label="旋钮逆时针"><RotateCcw size={13} /></button>
        <button type="button" className="knob-push" aria-label="按下旋钮" title={microPreferences.knobMode==='custom'?'执行分配操作；长按执行自定义操作':'按下选择；长按打开设置'}
          onPointerDown={(event) => { if(event.button!==0)return;event.currentTarget.setPointerCapture(event.pointerId);knobDrag.current={y:event.clientY,moved:false};knobHeldRef.current=false;knobHoldTimerRef.current=setTimeout(()=>{knobHeldRef.current=true;holdMicroKnob();},600); }}
          onPointerMove={event=>{const drag=knobDrag.current;if(!drag)return;const delta=drag.y-event.clientY;if(Math.abs(delta)>=18){if(knobHoldTimerRef.current)clearTimeout(knobHoldTimerRef.current);drag.moved=true;knobHeldRef.current=true;drag.y=event.clientY;turnMicroKnob(delta>0?1:-1);}}}
          onPointerUp={()=>{if(knobHoldTimerRef.current)clearTimeout(knobHoldTimerRef.current);knobDrag.current=null;}}
          onPointerCancel={()=>{if(knobHoldTimerRef.current)clearTimeout(knobHoldTimerRef.current);knobDrag.current=null;knobHeldRef.current=true;}}
          onLostPointerCapture={()=>{if(knobHoldTimerRef.current)clearTimeout(knobHoldTimerRef.current);knobDrag.current=null;}}
          onContextMenu={event=>event.preventDefault()}
          onKeyDown={event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();if(event.repeat)return;knobHeldRef.current=false;knobHoldTimerRef.current=setTimeout(()=>{knobHeldRef.current=true;holdMicroKnob();},600);}}}
          onKeyUp={event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();if(knobHoldTimerRef.current)clearTimeout(knobHoldTimerRef.current);selectMicroKnob();}}}
          onClick={selectMicroKnob}><span className="dial-face" style={{transform:`rotate(${dialAngle}deg)`}} /></button>
        <button type="button" className="knob-right" onClick={() => turnMicroKnob(1)} title="顺时针：下一项" aria-label="旋钮顺时针"><RotateCw size={13} /></button>
      </div>
      {Array.from({ length: 6 }, (_, index) => renderMicroAgentKey(index))}
      <div className={`micro-joystick ${joystickDirection?'pushed-'+joystickDirection:''}`} role="group" aria-label="摇杆"
        onKeyDown={event=>{const direction=({ArrowUp:'up',ArrowRight:'right',ArrowDown:'down',ArrowLeft:'left'} as const)[event.key as 'ArrowUp'];if(direction){event.preventDefault();if(!event.repeat)fireMicroJoystick(direction);}}}>
        <button type="button" className="joystick-cap" aria-label="拖动摇杆，或使用方向键"
          onPointerDown={event=>{if(event.button!==0)return;event.currentTarget.setPointerCapture(event.pointerId);joystickDrag.current={x:event.clientX,y:event.clientY,fired:false};}}
          onPointerMove={event=>{const drag=joystickDrag.current;if(!drag||drag.fired)return;const direction=microDragDirection(event.clientX-drag.x,event.clientY-drag.y);if(direction){drag.fired=true;setJoystickDirection(direction);fireMicroJoystick(direction);}}}
          onPointerUp={()=>{joystickDrag.current=null;setJoystickDirection(null);}}
          onPointerCancel={()=>{joystickDrag.current=null;setJoystickDirection(null);}}
          onLostPointerCapture={()=>{joystickDrag.current=null;setJoystickDirection(null);}} onContextMenu={event=>event.preventDefault()} />
        {microDirections.map(({id,label})=>{const binding=microPreferences.joystick[id];const unavailable=unavailableMicroAction(binding.action);const description=`摇杆向${label}：${microActions.find(a=>a.id===binding.action)?.label}`;return <button type="button" key={id} className={`joystick-${id}`} disabled={!unavailable&&microActionDisabled(binding)} aria-disabled={Boolean(unavailable)||undefined} aria-label={description} title={description} onClick={()=>fireMicroJoystick(id)}>{id==='up'?<ArrowUp size={14}/>:id==='right'?<ArrowRight size={14}/>:id==='down'?<ArrowDown size={14}/>:<ArrowLeft size={14}/>}</button>;})}
      </div>
      {microKeys.slice(0, 4).map(renderMicroCommandKey)}
      <div className="micro-connection" role="img" aria-label="黑色圆形部件与三颗指示灯（装饰）"><span className="micro-connection-leds" aria-hidden="true"><i /><i /><i /></span><span className="micro-black-disc" aria-hidden="true" /></div>
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
        <legend>Codex Micro</legend>
        <MicroSettings value={microPreferences} onChange={next=>{setMicroPreferences(next);setKnobIndex(null);}} tasks={history} />
        <div className="micro-customizer-heading"><span>COMMAND KEYS</span><button type="button" onClick={resetMicroKeys} title="恢复默认命令键和摇杆分配"><RotateCcw size={14} />重置布局</button></div>
        <div className="micro-keycap-list">
          <span className="micro-preview-knob" title="旋钮" aria-label="旋钮"><RotateCw size={18} /></span>
          {Array.from({ length: 6 }, (_, index) => <span key={index} className={`micro-preview-agent slot-${index + 1}`}>{index + 1}</span>)}
          <span className="micro-preview-joystick" title="摇杆" aria-label="摇杆"><Plus size={18} /></span>
          {microKeys.map((key) => <button type="button" key={key.id} className={`micro-keycap-option micro-${key.id} micro-color-${key.color}`} aria-pressed={editingMicroKey === key.id} onClick={() => setEditingMicroKey(key.id)} title={`编辑 ${key.label}`} aria-label={`编辑键位 ${key.id}`}>{renderMicroIcon(key.icon, 19)}<span>{key.label || 'KEY'}</span></button>)}
          <span className="micro-preview-connection" title="黑色圆形装饰" aria-label="黑色圆形装饰"><i /></span>
        </div>
        {activeMicroKey && <div className="micro-key-editor">
          <label htmlFor="micro-key-label">键帽文字</label>
          <input id="micro-key-label" value={activeMicroKey.label} maxLength={12} onChange={(event) => updateMicroKey(activeMicroKey.id, { label: event.target.value.toUpperCase() })} />
          <label htmlFor="micro-key-action">按键动作</label>
          <select id="micro-key-action" value={activeMicroKey.action} onChange={(event) => updateMicroKey(activeMicroKey.id, { action: event.target.value as MicroActionId })}><MicroActionOptions /></select>
          {activeMicroKey.action === 'prompt' && <><label htmlFor="micro-key-prompt">快捷指令</label><textarea id="micro-key-prompt" rows={3} maxLength={1000} value={activeMicroKey.prompt} onChange={(event) => updateMicroKey(activeMicroKey.id, { prompt: event.target.value })} /></>}
          <span className="micro-editor-label">键帽图标</span>
          <div className="micro-icon-options">{microIconOptions.map((icon) => <button type="button" key={icon.id} aria-pressed={activeMicroKey.icon === icon.id} onClick={() => updateMicroKey(activeMicroKey.id, { icon: icon.id })} title={icon.label} aria-label={icon.label}>{renderMicroIcon(icon.id, 18)}</button>)}</div>
          <span className="micro-editor-label">键帽配色（外观）</span>
          <div className="micro-color-options">{microColors.map((color) => <button type="button" key={color.id} className={`micro-color-${color.id}`} aria-pressed={activeMicroKey.color === color.id} onClick={() => updateMicroKey(activeMicroKey.id, { color: color.id })} title={color.label} aria-label={color.label}><i /></button>)}</div>
        </div>}
      </fieldset>}
      <fieldset className="theme-fieldset"><legend>外观配色</legend><div className="theme-options">{themes.map((item) => <button type="button" key={item.id} className={`theme-option ${item.id}`} aria-pressed={theme === item.id} onClick={() => selectTheme(item.id)} title={item.description}><i aria-hidden="true"><span /></i><strong>{item.label}</strong></button>)}</div></fieldset>
      {connection.mode !== 'demo' && <><label htmlFor="cwd">{connection.mode === 'remote' ? '远程工作目录' : '工作目录'}</label><input id="cwd" value={cwd} onChange={(event) => setCwd(event.target.value)} placeholder={connection.mode === 'remote' ? '/home/user/project' : 'C:\\path\\to\\project 或 /path/to/project'} /></>}
      {connection.mode === 'local' && <fieldset className="runtime-diagnostics"><legend>版本与诊断</legend>
        <dl><dt>网页</dt><dd>{__PANEL_REVISION__.slice(0, 8)}</dd>
          <dt>Connector</dt><dd>{runtimeDiagnostics ? (runtimeDiagnostics.connector.revision?.slice(0, 8) || runtimeDiagnostics.connector.version) : connectorRevision?.slice(0, 8) || '检测中'}</dd>
          {runtimeDiagnostics && <><dt>运行环境</dt><dd>{runtimeDiagnostics.platform} / {runtimeDiagnostics.arch} · Node {runtimeDiagnostics.node}</dd>
            {runtimeDiagnostics.providers.map(provider => <Fragment key={provider.id}><dt>{provider.label}</dt><dd>{provider.version || '未检测到'} · {provider.authenticated ? '已登录' : '未登录'}</dd></Fragment>)}
            <dt>语音识别</dt><dd>{runtimeDiagnostics.speech.backend} · {runtimeDiagnostics.speech.whisper.version || '版本未知'} · {runtimeDiagnostics.speech.whisper.status === 'ok' ? '可运行' : '需检查安装'}</dd>
            <dt>语音模型</dt><dd>{runtimeDiagnostics.speech.model}</dd>
            <dt>文字校对</dt><dd>{runtimeDiagnostics.speech.correction === 'off' ? '关闭' : '自动，失败保留原文'}</dd>
            <dt>录音解码</dt><dd>ffmpeg {runtimeDiagnostics.speech.ffmpeg.version || '版本未知'} · {runtimeDiagnostics.speech.ffmpeg.status === 'ok' ? '可运行' : '需检查安装'}</dd>
          </>}
        </dl>
        {connectorRevision && __PANEL_REVISION__ !== 'unknown' && connectorRevision !== __PANEL_REVISION__ && <p role="status">网页与电脑版本不同。先刷新页面；若仍提示不同，再更新并重启电脑 Connector。配对状态会保留。</p>}
        {diagnosticsError && <p role="status">{diagnosticsError}</p>}
        {runtimeDiagnostics && (runtimeDiagnostics.speech.whisper.status !== 'ok' || runtimeDiagnostics.speech.ffmpeg.status !== 'ok') && <p>{runtimeDiagnostics.speech.guidance || <>语音组件未就绪，可继续输入文字。请在电脑安装包中运行 Setup Voice，再重启 Connector；详情见<a href="https://github.com/x2v-co/vibe-coding-panel/blob/main/docs/configuration.md" target="_blank" rel="noreferrer">安装说明</a>。</>}</p>}
      </fieldset>}
      <p className="privacy-note"><ShieldCheck size={14} /><span>录音在电脑上转写，转写文字会通过电脑配置的 Claude 服务自动校对。发送前可直接修改输入框；共享 Relay 会转发内容，详见<a href="/privacy/" target="_blank" rel="noreferrer">隐私说明</a>与<a href="/terms/" target="_blank" rel="noreferrer">使用条款</a>。</span></p>
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
              <div className="display-status"><span className={`status-light ${status}`} /><span className="task-status-label" role="status" aria-live="polite"><span className="task-status-text">{isRecoveringJob ? '恢复中' : statusLabels[status]}</span><span className="task-agent-label"> / {nativeSelection ? `SESSION · ${nativeSelection.provider === 'claude' ? 'CLAUDE' : 'CODEX'}` : activeAgent.label.toUpperCase()}</span></span><div className="display-quick-actions"><button type="button" className="new-task-action" onClick={reset} disabled={busy || voiceBusy || isAddingContext || isRecoveringJob} title="新建任务" aria-label="新建任务"><Plus size={16} /></button><button type="button" className="context-action" onClick={() => imageInputRef.current?.click()} disabled={busy || voiceBusy || isAddingContext || isRecoveringJob} title="添加图片上下文" aria-label="添加图片上下文">{isAddingContext ? <RotateCw className="spin" size={16} /> : <ImagePlus size={16} />}</button><button type="button" className="history-action" onClick={() => setShowHistory(true)} title="任务记录" aria-label="任务记录"><History size={16} /></button><button type="button" className="micro-toolbar-action" onClick={() => setShowSettings(open => !open)} title="设置主题与工作目录" aria-label="设置主题与工作目录"><Palette size={16} /></button></div><span className="display-time"><Clock3 size={13} /> {busy ? duration : 'READY'}</span></div>
                <div className={`display-content ${isListening ? 'listening' : ''}`}>
                  {result && !busy && !capturePreview ? <div className="result-screen"><span className="screen-label">{status === 'stopped' ? '已停止' : status === 'failed' ? '任务异常' : 'TASK COMPLETE'}</span><div className="result-heading"><strong>{taskTitle}</strong><button type="button" className="copy-result" title={copied ? '已复制' : '复制结果'} aria-label={copied ? '已复制' : '复制结果'} onClick={async () => { await navigator.clipboard.writeText(result); setCopied(true); window.setTimeout(() => setCopied(false), 1500); }}>{copied ? <Check size={16} /> : <Copy size={16} />}</button></div><p>{result}</p></div>
                    : busy ? <div className="running-screen"><span className="screen-label">NOW RUNNING</span><strong>{taskTitle || '正在启动 Agent'}</strong><p>{latestProgress}</p><div className="progress-track"><i /></div></div>
                    : isRecoveringJob ? <div className="running-screen recovering-screen"><span className="screen-label">RESTORING SESSION</span><strong>正在恢复上次任务</strong><p>正在连接 Agent 并读取最新进度</p><div className="progress-track"><i /></div></div>
                    : <div className={`command-screen ${capturePreview ? 'has-capture' : ''}`}>{capturePreview && <div className="capture-preview"><img src={capturePreview} alt="已添加的图片上下文" /><div><span>VISUAL CONTEXT</span><strong>图片已装载</strong></div><button type="button" onClick={() => { setCapturePath(''); setCapturePreview(''); }} aria-label="移除图片"><X size={16} /></button></div>}{isListening && <div className="waveform" aria-hidden="true">{Array.from({ length: 28 }, (_, index) => <i key={index} />)}</div>}<div className="screen-label">{nativeSelection ? 'NATIVE SESSION' : isListening ? 'LISTENING' : isTranscribing ? 'TRANSCRIBING' : 'COMMAND DRAFT'}</div>{nativeSelection && <div className="native-selected-session"><strong>{nativeSelection.title}</strong><small role="status" aria-live="polite">{selectedHandoff?.state === 'releasing' || selectedHandoff?.state === 'timeout' || selectedHandoff?.state === 'error' ? selectedHandoff.message : confirmNativeRelease ? '请求交接：确认后将中断电脑上的当前任务' : nativeSelection.canResume === false ? (nativeSelection.canRelease === false ? '请在电脑退出 CLI，释放后可继续' : '电脑终端占用中：退出后可继续') : selectedHandoff?.state === 'released' ? selectedHandoff.message : '已连接，输入内容将继续此会话'}</small>{nativeSelection.canResume === false && nativeSelection.canRelease !== false && (nativeSelection.provider === 'codex' || nativeSelection.provider === 'claude') && (confirmNativeRelease ? <span className="release-native-confirm"><span>退出当前电脑终端？</span><button type="button" className="release-native-cancel" onClick={() => setConfirmNativeRelease(false)}>取消</button><button type="button" className="release-native-button danger" onClick={() => void releaseNativeTerminal()}>确认退出</button></span> : <button type="button" className="release-native-button" disabled={selectedHandoff?.state === 'releasing'} onClick={() => setConfirmNativeRelease(true)}>请求退出电脑终端</button>)}</div>}<label htmlFor="command">任务指令</label><textarea id="command" ref={promptRef} value={prompt} onChange={(event) => setPrompt(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void execute(); } }} rows={3} maxLength={3000} placeholder={isListening ? '正在录音，再按一次结束…' : isTranscribing ? '正在转写与校对…' : nativeSelection ? '继续这个原生会话…' : '按下语音键，或在这里输入…'} /></div>}
                </div>
                {result && !busy && !capturePreview && <textarea id="command" className="micro-followup" ref={promptRef} aria-label="继续当前任务" rows={2} value={prompt} maxLength={3000} placeholder={isListening ? '正在录音…' : isTranscribing ? '正在转写…' : '继续当前任务…'} onChange={(event) => setPrompt(event.target.value)} />}
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
          <div className="panel-notices">
          {connectionNotice && <div className="error-banner" role="status" aria-live="polite"><Wifi size={16} /><span>{connectionNotice}</span></div>}
          {error && <div className="error-banner" role="alert"><Terminal size={16} /><span>{error}</span>{canImportRecording && <button type="button" className="audio-import-action" onClick={() => audioInputRef.current?.click()}><FileAudio size={15} />系统录音</button>}<button onClick={() => { setError(''); setCanImportRecording(false); }} aria-label="关闭"><X size={15} /></button></div>}
          </div>
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

      {showHistory && <div className="drawer-backdrop" onMouseDown={() => setShowHistory(false)}><aside className="history-drawer" onMouseDown={(event) => event.stopPropagation()}><div className="drawer-heading"><div><span>{connection.mode === 'local' ? 'NATIVE SESSIONS' : 'PANEL TASKS'}</span><h2>{connection.mode === 'local' && historySource === 'native' ? '原生会话' : '任务记录'}</h2></div><button className="icon-button" onClick={() => setShowHistory(false)} aria-label="关闭"><X size={20} /></button></div>{connection.mode === 'local' && <div className="history-tabs"><button className={historySource === 'native' ? 'active' : ''} onClick={() => setHistorySource('native')}>原生会话</button><button className={historySource === 'panel' ? 'active' : ''} onClick={() => setHistorySource('panel')}>Panel 任务</button></div>}{historySource === 'native' && connection.mode === 'local' ? <><div className="native-session-hint">按 Workspace 筛选 · {agentProvider === 'claude' ? 'Claude Code' : 'Codex'}<br />选择后可读取原生对话；接续前请先退出原终端。</div>{nativeError && <div className="history-error">{nativeError}</div>}<div className="history-list">{nativeLoading && !nativeList.length ? <div className="history-empty"><RotateCw className="spin" size={24} /><p>正在读取原生会话</p></div> : nativeList.length === 0 ? <div className="history-empty"><History size={26} /><p>当前 Workspace 没有会话</p></div> : nativeList.map((session) => <button type="button" key={session.id} onClick={(event) => { event.stopPropagation(); chooseNativeSession(session); }} className="history-item"><span className="history-status completed"><History size={13} /></span><span className="history-copy"><strong>{session.title}</strong><small>{new Date(session.updatedAt).toLocaleString('zh-CN')}<br />{session.id}</small></span></button>)}{nativeCursor && <button className="history-more" onClick={() => void moreNativeSessions()}>加载更多</button>}</div></> : <div className="history-list">{history.length === 0 ? <div className="history-empty"><History size={26} /><p>还没有任务</p></div> : history.map((job) => <button key={job.id} onClick={() => loadJob(job)} className="history-item"><span className={`history-status ${job.status}`}>{job.status === 'running' || job.status === 'queued' ? <RotateCw size={13} /> : job.status === 'completed' ? <Check size={13} /> : <CircleStop size={13} />}</span><span className="history-copy"><strong>{job.prompt}</strong><small>{statusLabels[job.status]} · {job.agentProvider === 'claude' ? 'Claude Code' : 'Codex'}<br />{job.cwd}<br />{new Date(job.createdAt).toLocaleString('zh-CN')}</small></span></button>)}</div>}</aside></div>}

      {nativeSelection && nativeDetailsOpen && <div className="native-session-backdrop"><section className="native-session-dialog" role="dialog" aria-modal="true" aria-label="原生会话详情"><div className="drawer-heading"><div><span>{nativeSelection.provider === 'claude' ? 'CLAUDE CODE' : 'CODEX CLI'}</span><h2>{nativeSelection.title}</h2></div><button className="icon-button" disabled={busy} onClick={() => setNativeDetailsOpen(false)} aria-label="关闭"><X size={20} /></button></div><div className="native-session-messages">{nativeSelection.messages ? nativeSelection.messages.length ? nativeSelection.messages.map((message, index) => <div className={`native-message ${message.role}`} key={`${message.at}-${index}`}><span>{message.role === 'user' ? 'YOU' : 'AGENT'}</span><p>{message.text}</p></div>) : <p>会话没有可显示的文字消息</p> : <p>正在读取会话内容…</p>}</div><div className="native-session-hint">每 3 秒读取终端已保存的新消息。{nativeSelection.truncated && '仅展示部分历史。'}<br />{nativeSelection.canResume === false ? '终端仍占用会话：可查看，退出原 CLI 后才能接续。' : '已回到主面板，直接输入即可继续。'}<br /><code>{nativeSelection.provider === 'claude' ? 'claude --resume' : 'codex resume'} {nativeSelection.id}</code></div><div className="native-session-actions"><button disabled={busy} onClick={() => setNativeDetailsOpen(false)}>返回主面板</button></div></section></div>}

      {showWorkspacePicker && <div className="workspace-backdrop" onMouseDown={() => setShowWorkspacePicker(false)}><section className="workspace-picker" role="dialog" aria-modal="true" aria-labelledby="workspace-picker-title" onMouseDown={(event) => event.stopPropagation()}><div className="workspace-picker-heading"><div><span>AGENT FILESYSTEM</span><h2 id="workspace-picker-title">切换 Workspace</h2></div><button type="button" onClick={() => setShowWorkspacePicker(false)} aria-label="关闭目录选择器"><X size={19} /></button></div><form className="workspace-path-form" onSubmit={(event) => { event.preventDefault(); void browseWorkspace(workspacePath.trim()); }}><input aria-label="目录路径" value={workspacePath} onChange={(event) => setWorkspacePath(event.target.value)} spellCheck={false} /><button type="submit" disabled={workspaceLoading || !workspacePath.trim()} aria-label="打开输入的目录" title="打开目录">{workspaceLoading ? <RotateCw className="spin" size={17} /> : <ChevronRight size={17} />}</button></form><div className="workspace-browser-toolbar"><button type="button" onClick={() => workspaceParent && void browseWorkspace(workspaceParent)} disabled={!workspaceParent || workspaceLoading}><ArrowUp size={16} />上一级</button><span>{connection.mode === 'remote' ? 'REMOTE' : 'LOCAL'}</span></div><div className="workspace-directory-list">{workspaceError ? <div className="workspace-browser-empty error"><Terminal size={20} /><p>{workspaceError}</p></div> : workspaceLoading ? <div className="workspace-browser-empty"><RotateCw className="spin" size={21} /><p>正在读取目录</p></div> : workspaceDirectories.length ? workspaceDirectories.map((directory) => <button type="button" key={directory.path} onClick={() => void browseWorkspace(directory.path)}><FolderOpen size={17} /><span>{directory.name}</span><ChevronRight size={15} /></button>) : <div className="workspace-browser-empty"><Folder size={21} /><p>这个目录没有子目录</p></div>}</div><div className="workspace-picker-actions"><button type="button" onClick={() => setShowWorkspacePicker(false)}>取消</button><button type="button" className="select-workspace" onClick={selectWorkspace} disabled={workspaceLoading || Boolean(workspaceError) || !workspaceResolvedPath || workspacePath.trim() !== workspaceResolvedPath}><Check size={16} />选择当前目录</button></div></section></div>}

      <footer><span>VIBE PANEL / 2026</span><span className="footer-links"><a href="/privacy/" target="_blank" rel="noreferrer">隐私</a><a href="/terms/" target="_blank" rel="noreferrer">条款</a><a href="https://github.com/x2v-co/vibe-coding-panel/releases" target="_blank" rel="noreferrer">版本记录</a></span></footer>
    </div>
  );
}

function LandingPage() {
  return <div className="site-shell">
    <header className="site-nav"><a className="site-brand" href="/"><span className="site-mark"><Sparkles size={16} /></span><span>VIBE PANEL</span></a><nav><a href="#how-it-works">怎么工作</a><a href="/download">下载 Connector</a><a className="site-nav-action" href="/app">打开面板 <ChevronRight size={15} /></a></nav></header>
    <main>
      <section className="site-hero"><div className="site-hero-copy"><p className="site-kicker">A CONTROL SURFACE FOR YOUR AGENT</p><h1>把 Agent，<br /><em>握在手里。</em></h1><p>不用买外设。用手机的语音和几个关键按键，控制电脑上的 Codex 或 Claude Code。</p><div className="site-hero-actions"><a className="site-primary-action" href="/app">打开控制面板 <ArrowRight size={17} /></a><a className="site-secondary-action" href="/download">下载电脑 Connector</a></div><span className="site-note"><ShieldCheck size={14} />Agent 在电脑运行；内容经 Relay 转发</span></div><div className="site-hero-device"><div className="site-device-label">VIBE PANEL / CODEX MICRO</div><img src="/screenshots/runtime/panel-desktop.png" alt="Vibe Panel 控制面板运行截图" /></div></section>
      <section className="site-proof"><div><strong>01</strong><span>说</span><p>按住语音键，说出你的想法</p></div><div><strong>02</strong><span>看</span><p>添加屏幕或图片上下文</p></div><div><strong>03</strong><span>做</span><p>Agent 在你的项目里完成任务</p></div></section>
      <section className="site-how" id="how-it-works"><div><p className="site-kicker">THREE STEPS</p><h2>从打开到完成，<br />只需要一条连接。</h2></div><div className="site-steps"><div><b>1</b><strong>在电脑启动 Connector</strong><p>macOS 或 Windows 双击启动文件，自动检测 Agent、Whisper 和 ffmpeg。</p></div><div><b>2</b><strong>手机打开配对链接</strong><p>Connector 会生成一次性链接，不需要注册账号。</p></div><div><b>3</b><strong>选择项目，开始下令</strong><p>选择 Codex 或 Claude Code，然后用语音或文字创建任务。</p></div></div></section>
      <section className="site-cta"><p className="site-kicker">READY WHEN YOU ARE</p><h2>先在浏览器里试一次。</h2><p>演示模式不会读取文件，也不会运行命令。</p><a className="site-primary-action" href="/app">进入 Vibe Panel <ArrowRight size={17} /></a></section>
    </main>
    <footer className="site-footer"><span>VIBE PANEL / 2026</span><span><a href="/download">下载</a><a href="https://github.com/x2v-co/vibe-coding-panel">GitHub</a><a href="/privacy/">隐私</a><a href="/terms/">条款</a></span></footer>
  </div>;
}

function DownloadPage() {
  return <div className="site-shell download-shell">
    <header className="site-nav"><a className="site-brand" href="/"><span className="site-mark"><Sparkles size={16} /></span><span>VIBE PANEL</span></a><nav><a href="/">项目介绍</a><a className="site-nav-action" href="/app">打开面板 <ChevronRight size={15} /></a></nav></header>
    <main className="download-main"><div className="download-heading"><p className="site-kicker">GET STARTED ON DESKTOP</p><h1>下载 Connector。</h1><p>Connector 运行在你的电脑上，把手机面板安全地连接到本机的 Codex 或 Claude Code。</p></div><div className="download-card"><div className="download-card-icon"><Laptop size={24} /></div><div><h2>Vibe Panel Connector</h2><p>内测版 · 自带 Node.js 24 和运行依赖 · 解压即可启动</p><div className="download-packages">{[
      ['darwin-arm64', 'macOS · Apple Silicon'], ['darwin-x64', 'macOS · Intel'],
      ['win32-x64', 'Windows · x64'], ['linux-x64', 'Linux · x64'],
    ].map(([target, label]) => <a key={target} className="site-primary-action" href={`https://github.com/x2v-co/vibe-coding-panel/releases/latest/download/vibe-connector-${target}.zip`}>{label}<ArrowRight size={17} /></a>)}</div><p><a href="https://github.com/x2v-co/vibe-coding-panel/releases/latest">版本记录与 SHA256 校验</a></p></div></div><div className="download-guide"><h2>三步开始</h2><ol><li><b>下载并解压</b><span>按电脑系统和芯片选择 ZIP，完整解压。无需另装 Node.js；仍需安装并登录 Codex 或 Claude Code。</span></li><li><b>启动 Connector</b><span>macOS 双击 <code>Vibe Panel.command</code>；Windows 双击 <code>Vibe Panel.bat</code>；Linux 运行 <code>bash "Vibe Panel.sh"</code></span></li><li><b>手机扫描二维码</b><span>等待终端显示已连接，用手机相机扫描二维码。保持窗口运行和电脑唤醒。语音可运行安装包中的 Setup Voice 自动安装，完成后重启 Connector；未安装时可直接输入文字。</span></li></ol></div><p className="download-package-note">便携包尚未签名或公证，不是系统安装器。macOS 可能要求在“隐私与安全性”中允许打开；请遵循电脑的安全策略。Linux 需兼容 Node 24 的 glibc 系统（已测试 Ubuntu）。</p><div className="download-help"><ShieldCheck size={17} /><span><a href="https://github.com/x2v-co/vibe-coding-panel/blob/main/README.zh-CN.md">完整安装说明</a> · <a href="https://github.com/x2v-co/vibe-coding-panel/blob/main/docs/install-for-agents.md">让 Agent 安装</a> · 还没安装 Agent？<a href="/app">先用演示模式体验</a>。</span></div></main>
    <footer className="site-footer"><span>VIBE PANEL / 2026</span><span><a href="/">项目介绍</a><a href="/app">打开面板</a><a href="/privacy/">隐私</a><a href="/terms/">条款</a></span></footer>
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
