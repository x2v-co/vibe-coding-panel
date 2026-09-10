type State = 'online' | 'checking' | 'offline';

// Online events are hints. Only a fresh Connector response confirms recovery.
export function monitorConnection<T>({ load, onData, onState, browser = window, page = document,
  isOnline = () => navigator.onLine, intervalMs = 2000, timeoutMs = 10000 }: {
  load: (signal: AbortSignal) => Promise<T>;
  onData: (data: T) => void;
  onState: (state: State, error?: unknown) => void;
  browser?: EventTarget;
  page?: EventTarget & { hidden: boolean };
  isOnline?: () => boolean;
  intervalMs?: number;
  timeoutMs?: number;
}) {
  let stopped = false, generation = 0;
  let pending: AbortController | undefined;
  function invalidate() { generation++; pending?.abort(); pending = undefined; }
  function offline() { invalidate(); onState('offline'); }
  async function sync() {
    if (stopped) return;
    if (!isOnline()) { offline(); return; }
    if (pending || page.hidden) return;
    const controller = new AbortController();
    pending = controller;
    const current = generation;
    const timer = setTimeout(() => controller.abort(new Error('连接检测超时')), timeoutMs);
    try {
      const data = await load(controller.signal);
      if (stopped || current !== generation || controller.signal.aborted) return;
      if (!isOnline()) { offline(); return; }
      onState('online'); onData(data);
    } catch (error) {
      if (!stopped && current === generation) onState('offline', error);
    } finally {
      clearTimeout(timer);
      if (pending === controller) pending = undefined;
    }
  }
  function online() { invalidate(); onState('checking'); void sync(); }
  browser.addEventListener('offline', offline);
  browser.addEventListener('online', online);
  browser.addEventListener('focus', sync);
  page.addEventListener('visibilitychange', sync);
  const timer = setInterval(sync, intervalMs);
  void sync();
  return () => {
    stopped = true; invalidate(); clearInterval(timer);
    browser.removeEventListener('offline', offline);
    browser.removeEventListener('online', online);
    browser.removeEventListener('focus', sync);
    page.removeEventListener('visibilitychange', sync);
  };
}
