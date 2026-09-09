import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { WebSocket } from 'ws';
import { createRelayServer } from './relay.js';

function listen(server) {
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
}

function connectorIdentity(character) {
  const credential = character.repeat(64);
  return { credential, id: createHash('sha256').update(credential).digest('base64url') };
}

function openConnector(url, credential) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url, { headers: { Authorization: `Bearer ${credential}` } });
    socket.once('open', () => resolve(socket));
    socket.once('error', reject);
  });
}

test('relay forwards API responses between a browser and a Mac connector', async () => {
  const relay = createRelayServer({ maxConnectors: 2, maxInflight: 3, requestTimeoutMs: 2000 });
  const port = await listen(relay.server);
  const identity = connectorIdentity('a');
  const socket = await openConnector(`ws://127.0.0.1:${port}/relay/connect?id=${identity.id}`, identity.credential);

  try {
    socket.on('message', (raw) => {
      const message = JSON.parse(raw.toString());
      if (message.type !== 'request') return;
      socket.send(JSON.stringify({
        type: 'response-start', requestId: message.requestId, status: 200,
        headers: { 'content-type': 'application/json', 'cache-control': 'no-cache' },
      }));
      socket.send(JSON.stringify({
        type: 'response-chunk', requestId: message.requestId,
        data: Buffer.from(JSON.stringify({ ok: true, path: message.path })).toString('base64'),
      }));
      socket.send(JSON.stringify({ type: 'response-end', requestId: message.requestId }));
    });

    const health = await fetch(`http://127.0.0.1:${port}/healthz`).then((response) => response.json());
    assert.equal(health.connectors, 1);
    assert.deepEqual(health.capacity, { connectors: 2, inflight: 3 });

    const response = await fetch(`http://127.0.0.1:${port}/api/health`, {
      headers: { Cookie: `vibe_relay_connector=${identity.id}` },
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true, path: '/api/health' });
  } finally {
    socket.close();
    await new Promise((resolve) => socket.once('close', resolve));
    await new Promise((resolve) => relay.server.close(resolve));
  }
});

test('relay isolates browser traffic by connector id', async () => {
  const relay = createRelayServer();
  const port = await listen(relay.server);
  const first = connectorIdentity('a');
  const second = connectorIdentity('b');
  const firstSocket = await openConnector(`ws://127.0.0.1:${port}/relay/connect?id=${first.id}`, first.credential);
  const secondSocket = await openConnector(`ws://127.0.0.1:${port}/relay/connect?id=${second.id}`, second.credential);

  const respondAs = (socket, mac) => socket.on('message', (raw) => {
    const message = JSON.parse(raw.toString());
    if (message.type !== 'request') return;
    socket.send(JSON.stringify({ type: 'response-start', requestId: message.requestId, status: 200, headers: { 'content-type': 'application/json' } }));
    socket.send(JSON.stringify({ type: 'response-chunk', requestId: message.requestId, data: Buffer.from(JSON.stringify({ mac })).toString('base64') }));
    socket.send(JSON.stringify({ type: 'response-end', requestId: message.requestId }));
  });
  respondAs(firstSocket, 'first');
  respondAs(secondSocket, 'second');

  try {
    const firstResult = await fetch(`http://127.0.0.1:${port}/api/health`, {
      headers: { Cookie: `vibe_relay_connector=${first.id}` },
    }).then((response) => response.json());
    const secondResult = await fetch(`http://127.0.0.1:${port}/api/health`, {
      headers: { Cookie: `vibe_relay_connector=${second.id}` },
    }).then((response) => response.json());
    assert.deepEqual(firstResult, { mac: 'first' });
    assert.deepEqual(secondResult, { mac: 'second' });
  } finally {
    firstSocket.close();
    secondSocket.close();
    await Promise.all([
      new Promise((resolve) => firstSocket.once('close', resolve)),
      new Promise((resolve) => secondSocket.once('close', resolve)),
    ]);
    await new Promise((resolve) => relay.server.close(resolve));
  }
});

test('relay rejects a connector that does not own the requested id', async () => {
  const relay = createRelayServer();
  const port = await listen(relay.server);
  const owner = connectorIdentity('a');
  const attacker = connectorIdentity('b');
  try {
    await assert.rejects(
      openConnector(`ws://127.0.0.1:${port}/relay/connect?id=${owner.id}`, attacker.credential),
      /Unexpected server response: 401/,
    );
    assert.equal(relay.connectors.size, 0);
  } finally {
    await new Promise((resolve) => relay.server.close(resolve));
  }
});

test('relay does not let a second socket replace an online Mac', async () => {
  const relay = createRelayServer();
  const port = await listen(relay.server);
  const owner = connectorIdentity('a');
  const socket = await openConnector(`ws://127.0.0.1:${port}/relay/connect?id=${owner.id}`, owner.credential);
  try {
    await assert.rejects(
      openConnector(`ws://127.0.0.1:${port}/relay/connect?id=${owner.id}`, owner.credential),
      /Unexpected server response: 409/,
    );
    assert.equal(relay.connectors.size, 1);
    assert.ok(relay.connectors.has(owner.id));
    assert.equal(socket.readyState, WebSocket.OPEN);
  } finally {
    socket.close();
    await new Promise((resolve) => socket.once('close', resolve));
    await new Promise((resolve) => relay.server.close(resolve));
  }
});

test('relay rejects API traffic when its Mac connector is offline', async () => {
  const relay = createRelayServer();
  const port = await listen(relay.server);
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/health`, {
      headers: { Cookie: 'vibe_relay_connector=missing_connector_123456789' },
    });
    assert.equal(response.status, 503);
    assert.equal((await response.json()).code, 'CONNECTOR_OFFLINE');
    const entry = await fetch(`http://127.0.0.1:${port}/app?relay=missing_connector&pair=private-pair-code`);
    assert.equal(entry.status, 503);
    assert.match(entry.headers.get('content-type'), /text\/html.*utf-8/);
    const page = await entry.text();
    assert.match(page, /终端显示已连接后，刷新此页面/);
    assert.match(page, /name="viewport"/);
    assert.doesNotMatch(page, /private-pair-code/);
  } finally {
    await new Promise((resolve) => relay.server.close(resolve));
  }
});

test('malformed connector responses fail only their request and keep the relay available', async () => {
  const relay = createRelayServer({ requestTimeoutMs: 2000 });
  const port = await listen(relay.server);
  const identity = connectorIdentity('c');
  const socket = await openConnector(`ws://127.0.0.1:${port}/relay/connect?id=${identity.id}`, identity.credential);
  const invalid = {
    status: { status: 9999 },
    headerName: { headers: { 'invalid header': 'value' } },
    headerValue: { headers: { 'x-test': 'value\r\ninjected: yes' } },
    headerShape: { headers: null },
  };
  socket.on('message', (raw) => {
    const message = JSON.parse(raw.toString());
    if (message.type !== 'request') return;
    const variant = message.path.split('/').pop();
    socket.send(JSON.stringify({
      type: 'response-start', requestId: message.requestId, status: 200,
      headers: { 'content-type': 'application/json' }, ...invalid[variant],
    }));
    socket.send(JSON.stringify({ type: 'response-chunk', requestId: message.requestId, data: Buffer.from('{"ok":true}').toString('base64') }));
    socket.send(JSON.stringify({ type: 'response-end', requestId: message.requestId }));
  });
  try {
    socket.send('null');
    socket.send('[]');
    for (const variant of Object.keys(invalid)) {
      const response = await fetch(`http://127.0.0.1:${port}/api/${variant}`, {
        headers: { Cookie: `vibe_relay_connector=${identity.id}` },
      });
      assert.equal(response.status, 502, variant);
      assert.equal((await response.json()).code, 'INVALID_CONNECTOR_RESPONSE');
      assert.equal(relay.pending.size, 0);
    }
    const response = await fetch(`http://127.0.0.1:${port}/api/valid`, {
      headers: { Cookie: `vibe_relay_connector=${identity.id}` },
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true });
    assert.equal((await fetch(`http://127.0.0.1:${port}/healthz`).then((result) => result.json())).ok, true);
  } finally {
    socket.close();
    await new Promise((resolve) => socket.once('close', resolve));
    await new Promise((resolve) => relay.server.close(resolve));
  }
});

test('rate and pairing limits reject spoofed forwarding headers before body parsing', async () => {
  const relay = createRelayServer({ rateLimit: 10, pairLimit: 1, audit() {} });
  const port = await listen(relay.server);
  try {
    assert.equal((await fetch(`http://127.0.0.1:${port}/api/pair`, { method: 'POST' })).status, 503);
    const denied = await fetch(`http://127.0.0.1:${port}/api/pair`, { method: 'POST', headers: { 'X-Forwarded-For': 'other-client' } });
    assert.equal(denied.status, 429);
    assert.ok(Number(denied.headers.get('retry-after')) > 0);
    assert.equal(relay.pending.size, 0);
  } finally { await new Promise(resolve => relay.server.close(resolve)); }
});

test('oversized and compressed bodies are rejected with structured errors', async () => {
  const relay = createRelayServer({ maxBodyBytes: 32, audit() {} });
  const port = await listen(relay.server);
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/transcriptions`, { method: 'POST', body: 'x'.repeat(33) });
    assert.equal(response.status, 413);
    assert.equal((await response.json()).code, 'BODY_TOO_LARGE');
    assert.equal((await fetch(`http://127.0.0.1:${port}/api/pair`, { method: 'POST', body: 'x', headers: { 'Content-Encoding': 'gzip' } })).status, 415);
  } finally { await new Promise(resolve => relay.server.close(resolve)); }
});

test('timeouts cancel connector work and release capacity', async () => {
  const relay = createRelayServer({ requestTimeoutMs: 40, audit() {} });
  const port = await listen(relay.server);
  const identity = connectorIdentity('d');
  const socket = await openConnector(`ws://127.0.0.1:${port}/relay/connect?id=${identity.id}`, identity.credential);
  const cancellation = new Promise(resolve => socket.on('message', raw => { if (JSON.parse(raw).type === 'cancel') resolve(); }));
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/health`, { headers: { Cookie: `vibe_relay_connector=${identity.id}` } });
    assert.equal(response.status, 504);
    await cancellation;
    assert.equal(relay.pending.size, 0);
  } finally {
    socket.close();
    await new Promise(resolve => socket.once('close', resolve));
    await new Promise(resolve => relay.server.close(resolve));
  }
});

test('trusted proxy separates client limits but untrusted peers cannot', async () => {
  const relay = createRelayServer({ rateLimit: 1, trustProxy: '127.0.0.1', audit() {} });
  const port = await listen(relay.server);
  try {
    for (const ip of ['192.0.2.1', '192.0.2.2']) {
      assert.equal((await fetch(`http://127.0.0.1:${port}/api/health`, { headers: { 'X-Forwarded-For': ip } })).status, 503);
    }
    assert.equal((await fetch(`http://127.0.0.1:${port}/api/health`, { headers: { 'X-Forwarded-For': '192.0.2.1' } })).status, 429);
  } finally { await new Promise(resolve => relay.server.close(resolve)); }
});

test('browser disconnect cancels pending work immediately', async () => {
  const relay = createRelayServer({ requestTimeoutMs: 2000, audit() {} });
  const port = await listen(relay.server);
  const identity = connectorIdentity('e');
  const socket = await openConnector(`ws://127.0.0.1:${port}/relay/connect?id=${identity.id}`, identity.credential);
  const controller = new AbortController();
  const cancellation = new Promise(resolve => socket.on('message', raw => {
    const message = JSON.parse(raw);
    if (message.type === 'request') controller.abort();
    if (message.type === 'cancel') resolve();
  }));
  try {
    await assert.rejects(fetch(`http://127.0.0.1:${port}/api/health`, { signal: controller.signal, headers: { Cookie: `vibe_relay_connector=${identity.id}` } }));
    await cancellation;
    assert.equal(relay.pending.size, 0);
  } finally {
    socket.close();
    await new Promise(resolve => socket.once('close', resolve));
    await new Promise(resolve => relay.server.close(resolve));
  }
});

test('partial uploads consume bounded parser capacity and disconnect releases it', async () => {
  const { request } = await import('node:http');
  const relay = createRelayServer({ maxUploads: 1, audit() {} });
  const port = await listen(relay.server);
  const partial = request(`http://127.0.0.1:${port}/api/transcriptions`, { method: 'POST', headers: { 'Content-Length': '100' } });
  partial.on('error', () => {});
  partial.write('x');
  async function waitFor(count) {
    for (let i = 0; i < 100 && relay.uploading !== count; i++) await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(relay.uploading, count);
  }
  try {
    await waitFor(1);
    const response = await fetch(`http://127.0.0.1:${port}/api/health`);
    assert.equal(response.status, 503);
    assert.equal((await response.json()).code, 'RELAY_BUSY');
    partial.destroy();
    await waitFor(0);
  } finally {
    partial.destroy();
    await new Promise(resolve => relay.server.close(resolve));
  }
});
