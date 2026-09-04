import {
  ArrowUp, Camera, Check, ChevronRight, CircleStop, Clock3, Copy, Folder, FolderOpen, History,
  FileAudio, FlaskConical, ImagePlus, Keyboard, Laptop, Link2, Maximize2, Mic, MicOff, Minimize2,
  Palette, Play, Plus, RotateCw, Server, ShieldCheck, Smartphone, Sparkles, Terminal, Trash2, Wifi, X,
} from 'lucide-react';
import QRCode from 'qrcode';
import { ChangeEvent, FormEvent, useEffect, useMemo, useRef, useState } from 'react';

type JobStatus = 'idle' | 'queued' | 'running' | 'completed' | 'failed' | 'stopped';
type ThemeId = 'signal' | 'smoke' | 'ice' | 'midnight';
type LayoutId = 'console' | 'bar' | 'matrix' | 'hardware-tri' | 'hardware-vibebar' | 'hardware-five' | 'hardware-aha' | 'hardware-micro';
type ConnectionMode = 'demo' | 'local' | 'remote';
type ConnectionState = 'online' | 'checking' | 'offline' | 'unknown';
type AgentConnection = { mode: ConnectionMode; url: string; token: string };
type Activity = { id: number; at: number; type: string; text?: string; status?: string };
type SavedJob = {
  id: string; prompt: string; cwd: string; status: JobStatus; result?: string;
  createdAt: number; startedAt?: number | null; finishedAt?: number | null; events?: Activity[];
};
type WorkspaceDirectory = { name: string; path: string };
type PairedDevice = { id: string; name: string; userAgent: string; createdAt: number; lastSeenAt: number };
type PairingInfo = { code: string; expiresAt: number; pairingUrl: string };

const ACTIVE_JOB_KEY = 'vibe-panel-active-job-id';

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
  { id: 'hardware-micro', label: 'Codex Micro', description: '参考图五：方形多层键阵布局', previewKeys: 10 },
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

function App() {
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
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [canImportRecording, setCanImportRecording] = useState(false);
  const [isCapturing, setIsCapturing] = useState(false);
  const [capturePath, setCapturePath] = useState('');
  const [capturePreview, setCapturePreview] = useState('');
  const [isAddingContext, setIsAddingContext] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
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
  const [history, setHistory] = useState<SavedJob[]>(readHistory);
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
  const audioChunksRef = useRef<Blob[]>([]);
  const shouldTranscribeRef = useRef(false);
  const voiceSessionRef = useRef(0);
  const voiceStartPendingRef = useRef(false);
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const audioInputRef = useRef<HTMLInputElement | null>(null);
  const recoveryStartedRef = useRef(false);
  const demoRunRef = useRef(0);
  const sessionInitRef = useRef(false);

  const busy = status === 'queued' || status === 'running';
  const voiceBusy = isPreparingVoice || isListening || isTranscribing;
  const canExecute = Boolean(prompt.trim() || capturePath) && !busy && !voiceBusy;
  const latestProgress = [...activity].reverse().find((item) => item.text && item.type !== 'status')?.text
    || (busy ? '正在理解任务' : '等待下一条指令');
  const recentActivity = activity.filter((item) => item.type !== 'message').slice(-4);
  const activeLayout = layouts.find((item) => item.id === layout) || layouts[0];
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

  useEffect(() => {
    if (!busy || !startedAt) return;
    const tick = () => setElapsed(Date.now() - startedAt);
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [busy, startedAt]);

  useEffect(() => { latestPromptRef.current = prompt; }, [prompt]);

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
    stream.onerror = () => setError('实时连接中断，刷新页面可重新连接');
    return () => stream.close();
  // Follow-ups keep the same job id, so streamVersion explicitly starts a new subscription.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId, streamVersion, busy, isRecoveringJob, connection.mode]);

  const duration = useMemo(() => {
    const seconds = Math.max(0, Math.floor(elapsed / 1000));
    return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
  }, [elapsed]);

  async function refreshJob(id: string) {
    try {
      const response = await fetch(`/api/jobs/${id}`);
      if (response.status === 404) {
        if (localStorage.getItem(ACTIVE_JOB_KEY) === id) localStorage.removeItem(ACTIVE_JOB_KEY);
        return;
      }
      if (!response.ok) return;
      const job = await response.json() as SavedJob;
      setStatus(job.status);
      setActivity(Array.isArray(job.events) ? job.events : []);
      setResult(job.result || '');
      if (job.startedAt) setStartedAt(job.startedAt);
      if (['completed', 'failed', 'stopped'].includes(job.status)) storeJobInHistory(job);
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
    setStatus(job.status);
    setActivity(Array.isArray(job.events) ? job.events : []);
    setResult(job.result || '');
    setStartedAt(jobStartedAt);
    setElapsed(Math.max(0, (job.finishedAt || Date.now()) - jobStartedAt));
    setJobId(job.id);
    localStorage.setItem(ACTIVE_JOB_KEY, job.id);
    localStorage.setItem('vibe-panel-cwd', job.cwd);
    if (['completed', 'failed', 'stopped'].includes(job.status)) storeJobInHistory(job);
  }

  function buildCommand() {
    const text = prompt.trim();
    if (!capturePath) return text;
    const captureInstruction = connection.mode === 'demo'
      ? '结合已添加的图片上下文完成任务。'
      : `查看图片上下文 ${capturePath}，结合画面完成任务。`;
    return text ? `${text}\n\n${captureInstruction}` : captureInstruction;
  }

  async function execute(event?: FormEvent) {
    event?.preventDefault();
    const command = buildCommand();
    if (!command || busy) return;
    if (connection.mode === 'demo') {
      await runDemo(command);
      return;
    }
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
    setTaskTitle(title); setPrompt(''); setCapturePath(''); setCapturePreview(''); setJobId(id);
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

  async function submit(command: string) {
    setError(''); setActivity([]); setResult(''); setStatus('queued'); setStartedAt(Date.now());
    localStorage.setItem('vibe-panel-cwd', cwd);
    try {
      const response = await fetch('/api/jobs', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: command, cwd, connection: connectionPayload }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || '任务启动失败');
      setTaskTitle(prompt.trim() || '分析图片');
      setPrompt(''); setCapturePath(''); setCapturePreview(''); setJobId(payload.id);
      localStorage.setItem(ACTIVE_JOB_KEY, payload.id);
    } catch (reason) {
      setStatus('failed');
      setStartedAt(null);
      setError(reason instanceof Error ? reason.message : '任务启动失败');
    }
  }

  async function followUp(command: string) {
    if (!jobId) return;
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
    demoRunRef.current += 1;
    voiceSessionRef.current += 1;
    voiceStartPendingRef.current = false;
    stopListening(false);
    setIsPreparingVoice(false); setIsTranscribing(false); setCanImportRecording(false);
    setPrompt(''); setTaskTitle(''); setJobId(null); setStreamVersion(0); setStatus('idle');
    setActivity([]); setResult(''); setError(''); setCapturePath(''); setCapturePreview('');
    setStartedAt(null); setElapsed(0);
    localStorage.removeItem(ACTIVE_JOB_KEY);
    setShowWorkspacePicker(false);
  }

  function stopListening(transcribe = true) {
    shouldTranscribeRef.current = transcribe;
    if (mediaRecorderRef.current?.state !== 'inactive') mediaRecorderRef.current?.stop();
    else microphoneStreamRef.current?.getTracks().forEach((track) => track.stop());
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
      if (voiceSession === voiceSessionRef.current) setError(reason instanceof Error ? reason.message : '录音转写失败');
    } finally {
      if (voiceSession === voiceSessionRef.current) setIsTranscribing(false);
    }
  }

  async function startListening() {
    if (connection.mode === 'demo') {
      setError('演示模式不上传录音。与电脑完成配对后可使用本机 Whisper 语音输入');
      return;
    }
    if (voiceStartPendingRef.current) return;
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
      const preferredTypes = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm', 'audio/ogg;codecs=opus'];
      const mimeType = preferredTypes.find((type) => MediaRecorder.isTypeSupported(type));
      const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
      audioChunksRef.current = [];
      speechBaseRef.current = latestPromptRef.current.trim();
      shouldTranscribeRef.current = true;
      microphoneStreamRef.current = stream;
      mediaRecorderRef.current = recorder;
      recorder.ondataavailable = (event) => { if (event.data.size) audioChunksRef.current.push(event.data); };
      recorder.onerror = () => {
        setCanImportRecording(true);
        setError('录音被浏览器中断，请重试');
        stopListening(false);
      };
      recorder.onstop = () => {
        const shouldTranscribe = shouldTranscribeRef.current;
        const chunks = audioChunksRef.current;
        const recordedType = recorder.mimeType || chunks[0]?.type || 'audio/webm';
        microphoneStreamRef.current?.getTracks().forEach((track) => track.stop());
        microphoneStreamRef.current = null;
        mediaRecorderRef.current = null;
        audioChunksRef.current = [];
        if (!shouldTranscribe) return;
        const recording = new Blob(chunks, { type: recordedType });
        if (recording.size) void transcribeRecording(recording, voiceSession);
        else setError('没有录到声音，请重试');
      };
      setError('');
      setCanImportRecording(false);
      setIsListening(true);
      // Keep short commands in one final blob so the upload has no fragment boundaries.
      recorder.start();
    } catch (reason) {
      stream?.getTracks().forEach((track) => track.stop());
      if (voiceSession === voiceSessionRef.current) {
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
      setJobId(null); setStreamVersion(0); setTaskTitle(''); setStatus('idle');
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
    setStreamVersion((version) => version + 1);
    restoreJob(job);
    setShowHistory(false);
    if (!job.id.startsWith('demo-')) void refreshJob(job.id);
  }

  function renderStopKey(className = '') {
    return <button type="button" className={`console-key dark stop-key ${className}`} onClick={stop} disabled={!busy}><CircleStop size={25} /><span>PAUSE<br />REJECT</span><small>停止</small></button>;
  }

  function renderCaptureKey(className = '') {
    return <button type="button" className={`console-key dark capture-key ${className}`} onClick={addVisualContext} disabled={busy || isCapturing || voiceBusy || isAddingContext}>{isCapturing || isAddingContext ? <RotateCw className="spin" size={25} /> : canCaptureScreen ? <Camera size={25} /> : <ImagePlus size={25} />}<span>{canCaptureScreen ? 'CAPTURE' : 'IMAGE'}</span><small>{canCaptureScreen ? '捕获屏幕' : '选择图片'}</small></button>;
  }

  function renderVoiceKey(className = '', approve = false) {
    const shouldApprove = approve && canExecute;
    return <button type="button" className={`console-key voice-key ${isListening ? 'listening' : ''} ${className}`} onClick={shouldApprove ? () => void execute() : toggleSpeech} disabled={busy || isPreparingVoice || isTranscribing}>{shouldApprove ? <Check size={29} /> : isListening ? <MicOff size={31} /> : isPreparingVoice || isTranscribing ? <RotateCw className="spin" size={31} /> : <Mic size={31} />}<span>{shouldApprove ? 'APPROVE' : isListening ? 'LISTENING' : isPreparingVoice ? 'STARTING' : isTranscribing ? 'TRANSCRIBING' : approve ? 'VOICE APPROVE' : 'VOICE INPUT'}</span><small>{shouldApprove ? '批准执行' : isListening ? '再次按下结束' : isPreparingVoice ? '正在打开麦克风' : isTranscribing ? '正在转成文字' : '点按开始'}</small></button>;
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
      {renderSettingsKey('micro-top-key')}{renderWorkspaceKey('micro-top-key')}{renderHistoryKey('micro-top-key')}{renderFullscreenKey('micro-top-key')}
      {renderCaptureKey('micro-action-key')}{renderNewTaskKey('micro-action-key')}{renderStopKey('micro-action-key')}{renderExecuteKey('micro-action-key')}
      <div className="micro-dial" aria-hidden="true"><i /></div>{renderVoiceKey('micro-voice-key')}{renderSettingsKey('micro-brain-key')}
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
      <fieldset className="theme-fieldset"><legend>外观配色</legend><div className="theme-options">{themes.map((item) => <button type="button" key={item.id} className={`theme-option ${item.id}`} aria-pressed={theme === item.id} onClick={() => selectTheme(item.id)} title={item.description}><i aria-hidden="true"><span /></i><strong>{item.label}</strong></button>)}</div></fieldset>
      {connection.mode !== 'demo' && <><label htmlFor="cwd">{connection.mode === 'remote' ? '远程工作目录' : '工作目录'}</label><input id="cwd" value={cwd} onChange={(event) => setCwd(event.target.value)} placeholder={connection.mode === 'remote' ? '/home/user/project' : '/path/to/project'} /></>}
      <p className="privacy-note"><ShieldCheck size={14} />项目本身不收集任务、录音或代码。启用第三方 HTTPS Tunnel 时，流量还受该服务商的隐私条款约束。</p>
    </div>;
  }

  return (
    <div className={`app-shell layout-${layout} ${isPanelMode ? 'panel-mode' : ''}`} data-theme={theme}>
      <header className="topbar">
        <button className="brand" onClick={reset} aria-label="新建任务"><span className="brand-mark"><Sparkles size={17} /></span><span>VIBE PANEL</span><small>CODEX CONTROLLER</small></button>
        <div className="topbar-actions"><button className="connection" onClick={() => setShowSettings(true)} title="Agent 连接设置"><i className={connectionState} /><span>{connectionState === 'checking' ? 'CONNECTING' : agentLabel}</span></button><button className="header-button" onClick={() => setShowHistory(true)}><History size={18} /><span>历史</span></button><button className="header-button primary" onClick={reset}><Plus size={18} /><span>新任务</span></button></div>
      </header>

      <main>
        <section className="intro"><div className="intro-index">VP / 01</div><div><p className="eyebrow">NO HARDWARE REQUIRED</p><h1>把 Agent，<br />握在手里。</h1></div><p className="intro-copy"><strong>无需购买外设。</strong>打开 App 就能语音下令、捕获屏幕和执行任务，直接体验完整的 Vibe Coding 控制面板。</p></section>

        <section className="console-zone" aria-label="Agent 控制台">
          <div className="device">
            <div className="device-rail"><span>{activeLayout.label.toUpperCase()}</span><div className="speaker-grill" aria-hidden="true">{Array.from({ length: 11 }, (_, index) => <i key={index} />)}</div><button type="button" className="panel-mode-button" onClick={() => void togglePanelMode()} title={isPanelMode ? '退出全屏控制器' : '全屏控制器'} aria-label={isPanelMode ? '退出全屏控制器' : '全屏控制器'}>{isPanelMode ? <Minimize2 size={17} /> : <Maximize2 size={17} />}</button><button className={`knob ${showSettings ? 'active' : ''}`} onClick={() => setShowSettings((open) => !open)} title="主题与工作目录" aria-label="设置主题与工作目录"><span /></button></div>

            <div className="display-bezel"><div className="display">
              <div className="display-main">
                <div className="display-status"><span className={`status-light ${status}`} /><span>CODEX / {isRecoveringJob ? '恢复中' : statusLabels[status]}</span><div className="display-quick-actions"><button type="button" className="new-task-action" onClick={reset} disabled={busy || voiceBusy || isAddingContext || isRecoveringJob} title="新建任务" aria-label="新建任务"><Plus size={16} /></button><button type="button" className="context-action" onClick={() => imageInputRef.current?.click()} disabled={busy || voiceBusy || isAddingContext || isRecoveringJob} title="添加图片上下文" aria-label="添加图片上下文">{isAddingContext ? <RotateCw className="spin" size={16} /> : <ImagePlus size={16} />}</button><button type="button" className="history-action" onClick={() => setShowHistory(true)} title="任务记录" aria-label="任务记录"><History size={16} /></button></div><span className="display-time"><Clock3 size={13} /> {busy ? duration : 'READY'}</span></div>
                <div className={`display-content ${isListening ? 'listening' : ''}`}>
                  {capturePreview && !busy && !result ? <div className="capture-preview"><img src={capturePreview} alt="已添加的图片上下文" /><div><span>VISUAL CONTEXT</span><strong>图片已装载</strong></div><button type="button" onClick={() => { setCapturePath(''); setCapturePreview(''); }} aria-label="移除图片"><X size={16} /></button></div>
                    : result && !busy ? <div className="result-screen"><span className="screen-label">TASK COMPLETE</span><strong>{taskTitle}</strong><p>{result}</p><button onClick={async () => { await navigator.clipboard.writeText(result); setCopied(true); window.setTimeout(() => setCopied(false), 1500); }}>{copied ? <Check size={14} /> : <Copy size={14} />}{copied ? '已复制' : '复制结果'}</button></div>
                    : busy ? <div className="running-screen"><span className="screen-label">NOW RUNNING</span><strong>{taskTitle || '正在启动 Agent'}</strong><p>{latestProgress}</p><div className="progress-track"><i /></div></div>
                    : isRecoveringJob ? <div className="running-screen recovering-screen"><span className="screen-label">RESTORING SESSION</span><strong>正在恢复上次任务</strong><p>正在连接 Agent 并读取最新进度</p><div className="progress-track"><i /></div></div>
                    : <div className="command-screen">{isListening && <div className="waveform" aria-hidden="true">{Array.from({ length: 28 }, (_, index) => <i key={index} />)}</div>}<div className="screen-label">{isListening ? 'LISTENING' : isTranscribing ? 'TRANSCRIBING' : 'COMMAND DRAFT'}</div><label htmlFor="command">任务指令</label><textarea id="command" ref={promptRef} value={prompt} onChange={(event) => setPrompt(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void execute(); } }} rows={3} maxLength={3000} placeholder={isListening ? '正在录音，再按一次结束…' : isTranscribing ? '正在把语音转成文字…' : '按下语音键，或在这里输入…'} /></div>}
                </div>
                <div className="activity-strip">{recentActivity.length ? recentActivity.map((item) => <div key={item.id}><span>{item.type === 'tool' ? 'CMD' : item.type === 'status' ? 'SYS' : 'AI'}</span><p>{item.text}</p></div>) : <div><span>SYS</span><p>{capturePath ? '图片上下文已准备' : '等待输入'}</p></div>}</div>
              </div>
              <div className="display-side"><div className="counter"><strong>{busy ? '1' : '0'}</strong><span>运行中</span></div><div className="counter"><strong>{history.length}</strong><span>已完成</span></div><button type="button" className="workspace-readout" onClick={openWorkspacePicker} disabled={busy} title="切换 Workspace"><Folder size={15} /><span>{connection.mode === 'remote' ? 'REMOTE WORKSPACE' : 'WORKSPACE'} / 点击切换</span><strong>{cwd.split('/').filter(Boolean).pop() || '/'}</strong></button><div className={`signal-bars ${connectionState}`} aria-label={`Agent ${connectionState === 'online' ? '连接正常' : '等待连接'}`}><i /><i /><i /><i /></div></div>
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

        <section className="control-legend" aria-label="控制说明"><div><span>01</span><strong>说</strong><p>语音成为任务草稿</p></div><div><span>02</span><strong>看</strong><p>捕获当前屏幕上下文</p></div><div><span>03</span><strong>执行</strong><p>Codex 在项目中完成工作</p></div></section>
      </main>

      {showHistory && <div className="drawer-backdrop" onMouseDown={() => setShowHistory(false)}><aside className="history-drawer" onMouseDown={(event) => event.stopPropagation()}><div className="drawer-heading"><div><span>HISTORY</span><h2>任务记录</h2></div><button className="icon-button" onClick={() => setShowHistory(false)} aria-label="关闭"><X size={20} /></button></div><div className="history-list">{history.length === 0 ? <div className="history-empty"><History size={26} /><p>还没有完成的任务</p></div> : history.map((job) => <button key={job.id} onClick={() => loadJob(job)} className="history-item"><span className={`history-status ${job.status}`}><Check size={13} /></span><span className="history-copy"><strong>{job.prompt}</strong><small>{job.cwd}<br />{new Date(job.createdAt).toLocaleString('zh-CN')}</small></span></button>)}</div></aside></div>}

      {showWorkspacePicker && <div className="workspace-backdrop" onMouseDown={() => setShowWorkspacePicker(false)}><section className="workspace-picker" role="dialog" aria-modal="true" aria-labelledby="workspace-picker-title" onMouseDown={(event) => event.stopPropagation()}><div className="workspace-picker-heading"><div><span>AGENT FILESYSTEM</span><h2 id="workspace-picker-title">切换 Workspace</h2></div><button type="button" onClick={() => setShowWorkspacePicker(false)} aria-label="关闭目录选择器"><X size={19} /></button></div><form className="workspace-path-form" onSubmit={(event) => { event.preventDefault(); void browseWorkspace(workspacePath.trim()); }}><input aria-label="目录路径" value={workspacePath} onChange={(event) => setWorkspacePath(event.target.value)} spellCheck={false} /><button type="submit" disabled={workspaceLoading || !workspacePath.trim()} aria-label="打开输入的目录" title="打开目录">{workspaceLoading ? <RotateCw className="spin" size={17} /> : <ChevronRight size={17} />}</button></form><div className="workspace-browser-toolbar"><button type="button" onClick={() => workspaceParent && void browseWorkspace(workspaceParent)} disabled={!workspaceParent || workspaceLoading}><ArrowUp size={16} />上一级</button><span>{connection.mode === 'remote' ? 'REMOTE' : 'LOCAL'}</span></div><div className="workspace-directory-list">{workspaceError ? <div className="workspace-browser-empty error"><Terminal size={20} /><p>{workspaceError}</p></div> : workspaceLoading ? <div className="workspace-browser-empty"><RotateCw className="spin" size={21} /><p>正在读取目录</p></div> : workspaceDirectories.length ? workspaceDirectories.map((directory) => <button type="button" key={directory.path} onClick={() => void browseWorkspace(directory.path)}><FolderOpen size={17} /><span>{directory.name}</span><ChevronRight size={15} /></button>) : <div className="workspace-browser-empty"><Folder size={21} /><p>这个目录没有子目录</p></div>}</div><div className="workspace-picker-actions"><button type="button" onClick={() => setShowWorkspacePicker(false)}>取消</button><button type="button" className="select-workspace" onClick={selectWorkspace} disabled={workspaceLoading || Boolean(workspaceError) || !workspaceResolvedPath || workspacePath.trim() !== workspaceResolvedPath}><Check size={16} />选择当前目录</button></div></section></div>}

      <footer><span>VIBE PANEL / 2026</span><span>BREAK THE KEYBOARD. JUST BUILD.</span></footer>
    </div>
  );
}

export default App;
