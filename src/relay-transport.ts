// Keep the page (and its PWA storage) on one origin while moving only API
// traffic. Authentication uses host-only HttpOnly cookies on each Relay.
const nativeFetch = window.fetch.bind(window);
const nativeEventSource = window.EventSource;
const routeEvents = new EventTarget();
let origins: string[] = [];
let active = '';
let connector = '';
let instanceId = '';
let selecting: Promise<boolean> | undefined;
let provisioning = false;
let lastProvision = 0;

function remember(key: string, value?: string) {
  try { if (value !== undefined) localStorage.setItem(key, value); return localStorage.getItem(key) || ''; } catch { return ''; }
}
function headersFor(init?: RequestInit) {
  const headers = new Headers(init?.headers);
  headers.set('X-Vibe-Connector-Id', connector);
  return headers;
}
function raw(origin: string, path: string, init: RequestInit = {}) {
  return nativeFetch(`${origin}${path}`, { ...init, credentials: 'include', cache: 'no-store', headers: headersFor(init), signal: init.signal || AbortSignal.timeout(15000) });
}
async function choose(exclude = '') {
  if (selecting) return selecting;
  selecting = (async () => {
    const candidates = await Promise.all(origins.filter(origin => origin !== exclude).map(async origin => {
      const started = performance.now();
      try {
        const response = await raw(origin, '/api/health', { signal: AbortSignal.timeout(4000) });
        if (!response.ok) return null;
        const health = await response.json();
        if (!health.ok) return null;
        return { origin, elapsed: performance.now() - started, paired: health.paired === true, instanceId: String(health.instanceId || '') };
      } catch { return null; }
    }));
    const valid = candidates.filter(item => item !== null);
    // Prefer an already-authorized node after a previous pairing. Latency only
    // breaks ties; we do not bounce between nodes on every API request.
    valid.sort((a, b) => Number(b.paired) - Number(a.paired) || a.elapsed - b.elapsed);
    const chosen = valid[0];
    if (!chosen) return false;
    const changed = active !== chosen.origin;
    active = chosen.origin;
    instanceId = chosen.instanceId;
    remember(`vibe-relay-node:${connector}`, active);
    if (changed) routeEvents.dispatchEvent(new Event('change'));
    return true;
  })();
  try { return await selecting; } finally { selecting = undefined; }
}

async function provision() {
  if (!active || provisioning || Date.now() - lastProvision < 30000) return;
  provisioning = true;
  lastProvision = Date.now();
  try {
    const response = await raw(active, '/api/relay-tickets', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    if (!response.ok) return;
    const payload = await response.json();
    await Promise.allSettled((payload.tickets || []).filter((item: { origin: string }) => origins.includes(item.origin)).map((item: { origin: string; ticket: string }) =>
      raw(item.origin, '/api/relay-authorize', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ticket: item.ticket }) })));
  } catch { /* The active node stays usable while a standby is unavailable. */ }
  finally { provisioning = false; }
}

export async function initializeRelayTransport() {
  if (!['/', '/app'].includes(location.pathname)) return;
  try {
    const response = await nativeFetch('/relay/config', { cache: 'no-store', signal: AbortSignal.timeout(3000) });
    const config = await response.json();
    if (!config.enabled) return;
    const query = new URL(location.href).searchParams.get('relay') || '';
    connector = query || remember('vibe-relay-connector');
    if (!/^[A-Za-z0-9_-]{43}$/.test(connector)) { connector = ''; return; }
    remember('vibe-relay-connector', connector);
    origins = config.origins.filter((origin: string) => {
      try { const url = new URL(origin); return url.origin === origin && (url.protocol === 'https:' || ['localhost', '127.0.0.1'].includes(url.hostname)); } catch { return false; }
    }).slice(0, 4);
    if (!origins.length) { connector = ''; return; }
    active = remember(`vibe-relay-node:${connector}`);
    if (!origins.includes(active)) active = origins[0];
    await choose();
  } catch { /* Legacy Relay and direct/local servers retain their old behavior. */ }
}

export async function apiFetch(input: string, init: RequestInit = {}): Promise<Response> {
  if (!active || !input.startsWith('/api/')) return nativeFetch(input, init);
  const method = (init.method || 'GET').toUpperCase();
  const mutation = !['GET', 'HEAD'].includes(method);
  const noReplay = ['/api/pair', '/api/relay-tickets', '/api/relay-authorize', '/api/pairing-codes'].includes(input);
  const requestHeaders = headersFor(init);
  const originalInstance = instanceId;
  if (mutation && !noReplay && instanceId) {
    requestHeaders.set('X-Vibe-Request-Id', crypto.randomUUID());
    requestHeaders.set('X-Vibe-Instance-Id', instanceId);
  }
  // Fail a stalled health/job poll before the UI monitor's 10s cancellation,
  // leaving time to select a standby. Otherwise a blackholed node would keep
  // being retried forever because every caller abort looked like navigation.
  const timeout = mutation ? 180000 : input === '/api/jobs' || input === '/api/health' ? 6000 : 15000;
  const requestSignal = () => init.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(timeout)]) : AbortSignal.timeout(timeout);
  const options = { ...init, headers: requestHeaders, signal: requestSignal() };
  let response: Response | undefined;
  let failure: unknown;
  const previous = active;
  try { response = await raw(previous, input, options); } catch (error) { failure = error; }
  if ((!response || [502, 503, 504].includes(response.status)) && !init.signal?.aborted) {
    const switched = await choose(previous);
    const safeReplay = !mutation || (!noReplay && originalInstance && originalInstance === instanceId);
    if (switched && safeReplay) {
      // Reuse the same id. The computer deduplicates even when both regional
      // requests reach it; its boot id prevents replay after a restart.
      response = await raw(active, input, { ...options, signal: requestSignal() });
    }
  }
  if (!response) throw failure || new Error('电脑连接暂时不可用，请确认上次操作结果后重试');
  if (response.ok && input === '/api/health') {
    const health = await response.clone().json();
    instanceId = String(health.instanceId || '');
    if (health.paired) void provision();
  }
  if (response.ok && input === '/api/pair') { lastProvision = 0; await provision(); }
  if (response.ok && input === '/api/jobs') void provision();
  return response;
}

export class RelayEventSource {
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  private stream?: EventSource;
  private closed = false;
  private path: string;
  private retry?: ReturnType<typeof setTimeout>;
  private reconnect = () => this.open();
  constructor(path: string) { this.path = path; routeEvents.addEventListener('change', this.reconnect); this.open(); }
  private open() {
    if (this.closed) return;
    this.stream?.close();
    clearTimeout(this.retry);
    const url = new URL(this.path, active || location.origin);
    if (active) url.searchParams.set('connector', connector);
    const stream = this.stream = new nativeEventSource(url, { withCredentials: true });
    stream.onmessage = event => this.onmessage?.(event);
    stream.onerror = event => {
      this.onerror?.(event);
      if (!active || this.retry) return;
      this.retry = setTimeout(async () => {
        this.retry = undefined;
        if (this.closed) return;
        await choose(active);
        if (!this.closed && this.stream === stream) this.open();
      }, 2000);
    };
  }
  close() { this.closed = true; clearTimeout(this.retry); this.stream?.close(); routeEvents.removeEventListener('change', this.reconnect); }
}
