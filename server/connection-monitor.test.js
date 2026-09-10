import test from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers/promises';
import { monitorConnection } from '../src/connection-monitor.ts';

function harness() {
  const browser = new EventTarget(), page = Object.assign(new EventTarget(), { hidden: false });
  let online = true;
  const states = [], data = [], requests = [];
  const stop = monitorConnection({ browser, page, isOnline: () => online, intervalMs: 60000,
    load: signal => new Promise((resolve, reject) => requests.push({ signal, resolve, reject })),
    onState: state => states.push(state), onData: value => data.push(value) });
  return { browser, page, states, data, requests, stop,
    network(value) { online = value; browser.dispatchEvent(new Event(value ? 'online' : 'offline')); } };
}

test('offline immediately invalidates stale success; recovery requires a fresh request', async () => {
  const h = harness();
  try {
    h.network(false);
    assert.equal(h.states.at(-1), 'offline');
    assert(h.requests[0].signal.aborted);
    h.requests[0].resolve(['stale']); await setImmediate();
    assert.equal(h.states.at(-1), 'offline'); assert.deepEqual(h.data, []);
    h.network(true);
    assert.equal(h.states.at(-1), 'checking'); assert.equal(h.requests.length, 2);
    h.requests[1].resolve(['saved task']); await setImmediate();
    assert.equal(h.states.at(-1), 'online'); assert.deepEqual(h.data, [['saved task']]);
  } finally { h.stop(); }
});

test('failed polling preserves last data; returning to the page retries without a browser online event', async () => {
  const h = harness();
  try {
    h.requests[0].resolve(['completed']); await setImmediate();
    h.browser.dispatchEvent(new Event('focus'));
    h.requests[1].reject(new TypeError('Failed to fetch')); await setImmediate();
    assert.equal(h.states.at(-1), 'offline'); assert.deepEqual(h.data, [['completed']]);
    h.page.hidden = true; h.page.dispatchEvent(new Event('visibilitychange'));
    assert.equal(h.requests.length, 2);
    h.page.hidden = false; h.page.dispatchEvent(new Event('visibilitychange'));
    h.requests[2].resolve(['completed']); await setImmediate();
    assert.equal(h.states.at(-1), 'online');
    h.stop(); h.network(false);
    assert.equal(h.states.at(-1), 'online');
  } finally { h.stop(); }
});

test('timed-out requests fail closed and periodic polling recovers', async () => {
  const browser = new EventTarget(), page = Object.assign(new EventTarget(), { hidden: false });
  const states = []; let calls = 0, recovered;
  const done = new Promise(resolve => { recovered = resolve; });
  const stop = monitorConnection({ browser, page, isOnline: () => true, timeoutMs: 10, intervalMs: 20,
    load: signal => ++calls === 1 ? new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason))) : Promise.resolve('recovered'),
    onState: state => states.push(state), onData: recovered });
  try { await done; assert(states.includes('offline')); assert.equal(states.at(-1), 'online'); }
  finally { stop(); }
});
