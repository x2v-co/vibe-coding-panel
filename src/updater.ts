// Keeps installed PWAs current without an uninstall/reinstall. Two signals are
// watched: a waiting service worker (new sw.js shipped) and dist/version.json
// (the web revision this origin is actually serving). When either changes the
// app shows an update banner; applying it activates the worker or reloads into
// the network-first shell.

export type UpdateChannel = 'service-worker' | 'reload';

export interface UpdateState {
  available: boolean;
  revision: string | null;
  channel: UpdateChannel;
}

const listeners = new Set<() => void>();
let state: UpdateState = { available: false, revision: null, channel: 'reload' };
let registration: ServiceWorkerRegistration | null = null;
let started = false;
let applying = false;

function patch(next: Partial<UpdateState>) {
  state = { ...state, ...next };
  for (const listener of listeners) listener();
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function getUpdateState(): UpdateState {
  return state;
}

function trackInstalling(worker: ServiceWorker | null) {
  if (!worker) return;
  const onChange = () => {
    // On first install there is no controller yet; a controller plus an
    // 'installed' worker means a new release is waiting.
    if (worker.state === 'installed' && navigator.serviceWorker.controller) {
      patch({ available: true, channel: 'service-worker' });
    }
  };
  worker.addEventListener('statechange', onChange);
  onChange();
}

async function checkServerRevision() {
  try {
    const response = await fetch('/version.json', { cache: 'no-store' });
    if (!response.ok) return;
    const payload = (await response.json()) as { revision?: unknown };
    const revision = typeof payload.revision === 'string' ? payload.revision : null;
    if (revision && __PANEL_REVISION__ !== 'unknown' && revision !== __PANEL_REVISION__) {
      patch({ available: true, revision, channel: state.available ? state.channel : 'reload' });
    }
  } catch {
    // Offline or transient relay failure; the next check retries.
  }
}

export function startUpdater(): void {
  if (started || !('serviceWorker' in navigator)) return;
  started = true;

  // A controller change must only reload after the user asked to apply.
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (applying) window.location.reload();
  });

  void navigator.serviceWorker
    .register('/sw.js')
    .then((reg) => {
      registration = reg;
      if (reg.waiting && navigator.serviceWorker.controller) patch({ available: true, channel: 'service-worker' });
      trackInstalling(reg.installing);
      reg.addEventListener('updatefound', () => trackInstalling(reg.installing));
    })
    .catch(() => { /* registration is best effort */ });

  const refresh = () => {
    void registration?.update();
    void checkServerRevision();
  };
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') refresh();
  });
  window.addEventListener('focus', refresh);
  window.setInterval(() => { void checkServerRevision(); }, 5 * 60 * 1000);
  void checkServerRevision();
}

export function applyUpdate(): void {
  if (!state.available || applying) return;
  applying = true;
  const waiting = registration?.waiting;
  if (state.channel === 'service-worker' && waiting) {
    waiting.postMessage({ type: 'SKIP_WAITING' });
    // controllerchange fires once the worker claims clients; reload as a
    // fallback if the swap does not arrive.
    window.setTimeout(() => window.location.reload(), 1200);
    return;
  }
  window.location.reload();
}
