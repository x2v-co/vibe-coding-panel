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
