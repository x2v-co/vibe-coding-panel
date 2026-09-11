import test from 'node:test';
import assert from 'node:assert/strict';

test('browser retries ambiguous writes with one id, but never across a computer restart', async () => {
  const originalWindow = globalThis.window, originalLocation = globalThis.location, originalStorage = globalThis.localStorage;
  const origins = ['https://vibe-relay-cn.toolkit.fun', 'https://vibe-relay-global.toolkit.fun'];
  const values = new Map();
  let boot = 'boot-1', fail = '', actions = [];
  const json = data => new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } });
  globalThis.location = { pathname: '/app', href: `https://vibe.toolkit.fun/app?relay=${'a'.repeat(43)}`, origin: 'https://vibe.toolkit.fun' };
  globalThis.localStorage = { setItem: (key, value) => values.set(key, value), getItem: key => values.get(key) || null };
  globalThis.window = { EventSource: class {}, fetch: async (input, init) => {
    if (input === '/relay/config') return json({ enabled: true, origins });
    const url = new URL(input);
    if (url.pathname === '/api/health') return json({ ok: true, paired: true, instanceId: boot });
    if (url.pathname === '/api/action') {
      actions.push({ origin: url.origin, id: init.headers.get('X-Vibe-Request-Id'), boot: init.headers.get('X-Vibe-Instance-Id') });
      if (url.origin === fail) throw new TypeError('Connection lost after sending');
      return json({ ok: true });
    }
    return json({ tickets: [] });
  } };
  try {
    const transport = await import(`../src/relay-transport.ts?test=${Date.now()}`);
    await transport.initializeRelayTransport();
    fail = values.get(`vibe-relay-node:${'a'.repeat(43)}`);
    assert.equal((await transport.apiFetch('/api/action', { method: 'POST', body: '{}' })).status, 200);
    assert.equal(actions.length, 2);
    assert.equal(actions[0].id, actions[1].id);
    assert.ok(actions[0].id);
    assert.notEqual(actions[0].origin, actions[1].origin);
    actions = [];
    fail = values.get(`vibe-relay-node:${'a'.repeat(43)}`);
    boot = 'boot-2';
    await assert.rejects(transport.apiFetch('/api/action', { method: 'POST', body: '{}' }), /Connection lost/);
    assert.equal(actions.length, 1, 'new boot must not replay a possibly executed command');
  } finally {
    if (originalWindow === undefined) delete globalThis.window; else globalThis.window = originalWindow;
    if (originalLocation === undefined) delete globalThis.location; else globalThis.location = originalLocation;
    if (originalStorage === undefined) delete globalThis.localStorage; else globalThis.localStorage = originalStorage;
  }
});
