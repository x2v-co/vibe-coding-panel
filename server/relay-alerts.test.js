import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import http from 'node:http';
import net from 'node:net';
import { promisify } from 'node:util';
import test from 'node:test';
import { alertConfig, createAlerter, postJson } from './relay-quality.js';

const exec = promisify(execFile);
const quiet = () => {};

async function fakeServer(t, handler) {
  const requests = [];
  const server = http.createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    requests.push({ path: request.url, body: JSON.parse(Buffer.concat(chunks).toString('utf8')) });
    handler(response, request);
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  return { server, requests, url: `http://127.0.0.1:${server.address().port}/test-only` };
}

test('alert config reads independent webhook format and proxy settings', () => {
  const config = alertConfig({}, {
    PANEL_RELAY_ALERT_WEBHOOK_FORMAT: ' Feishu ',
    PANEL_RELAY_ALERT_PROXY: 'http://127.0.0.1:10001',
    PANEL_RELAY_ALERT_WEBHOOK_PROXY: 'http://127.0.0.1:10002',
  });
  assert.equal(config.webhookFormat, 'feishu');
  assert.equal(config.proxy, 'http://127.0.0.1:10001');
  assert.equal(config.webhookProxy, 'http://127.0.0.1:10002');
  assert.equal(alertConfig({ alertWebhookFormat: 'feishu', alertWebhookProxy: 'http://127.0.0.1:10003' }, {}).webhookProxy, 'http://127.0.0.1:10003');
});

test('Feishu and Lark host detection uses the exact hostname (all sends mocked)', async () => {
  for (const [host, feishu] of [
    ['open.feishu.cn', true], ['open.larksuite.com', true], ['OPEN.FEISHU.CN', true],
    ['open.feishu.cn.example.invalid', false], ['example.invalid', false],
  ]) {
    const calls = [];
    const alerter = createAlerter(alertConfig({ alertWebhook: `https://${host}/test-only` }, {}), {
      send: async (_url, payload, options) => { calls.push({ payload, options }); },
    });
    assert.equal(await alerter.notify('hello'), true);
    assert.deepEqual(calls, [{
      payload: feishu ? { msg_type: 'text', content: { text: '[vibe-relay] hello' } } : { text: '[vibe-relay] hello' },
      options: { proxy: '', requireCodeZero: feishu },
    }]);
  }
});

test('Feishu override posts the native envelope directly, ignoring the Telegram proxy', async t => {
  const fake = await fakeServer(t, response => response.end('{"code":0}'));
  const alerter = createAlerter(alertConfig({
    alertWebhook: fake.url, alertWebhookFormat: 'feishu', alertProxy: 'http://127.0.0.1:1',
  }, {}));
  assert.equal(await alerter.notify('cn connection alert'), true);
  assert.deepEqual(fake.requests, [{ path: '/test-only', body: { msg_type: 'text', content: { text: '[vibe-relay] cn connection alert' } } }]);
});

test('generic webhooks retain the text envelope and accept a non-JSON 2xx response', async t => {
  const fake = await fakeServer(t, response => { response.writeHead(204); response.end(); });
  const alerter = createAlerter(alertConfig({ alertWebhook: fake.url, alertProxy: 'http://127.0.0.1:1' }, {}));
  assert.equal(await alerter.notify('generic alert'), true);
  assert.deepEqual(fake.requests[0].body, { text: '[vibe-relay] generic alert' });
});

test('Feishu API errors, invalid acknowledgments, and HTTP errors fail without logging response data', async t => {
  for (const [body, status, reason] of [
    ['{"code":19001,"msg":"test-sensitive-marker"}', 200, 'Feishu response code 19001'],
    ['{"code":"0"}', 200, 'Feishu response missing numeric code'],
    ['{}', 200, 'Feishu response missing numeric code'],
    ['null', 200, 'Feishu response missing numeric code'],
    ['test-sensitive-marker', 200, 'invalid Feishu JSON response'],
    ['', 200, 'invalid Feishu JSON response'],
    ['{"code":0}', 500, 'HTTP 500'],
    ['{"code":0}', 302, 'HTTP 302'],
  ]) {
    await t.test(reason, async t => {
      const fake = await fakeServer(t, response => { response.writeHead(status); response.end(body); });
      const logs = [];
      const alerter = createAlerter(alertConfig({ alertWebhook: fake.url, alertWebhookFormat: 'feishu' }, {}), { log: line => logs.push(line) });
      assert.equal(await alerter.notify('test'), false);
      assert.deepEqual(logs, [`[relay-alerts] webhook delivery failed: ${reason}`]);
      assert.doesNotMatch(logs.join('\n'), /127\.0\.0\.1|test-sensitive-marker|test-only/);
    });
  }
});

test('oversized Feishu responses and stalled requests fail', async t => {
  const large = await fakeServer(t, response => response.end('x'.repeat(70 * 1024)));
  await assert.rejects(postJson(large.url, {}, { requireCodeZero: true }), /response too large/);
  const stalled = await fakeServer(t, () => {});
  await assert.rejects(postJson(stalled.url, {}, { timeoutMs: 50 }), /timeout/);
});

test('Telegram remains available when the webhook fails; each channel uses its own proxy', async t => {
  const fake = await fakeServer(t, (response, request) => {
    response.end(request.url === '/telegram-test' ? '{"ok":true}' : '{"code":19001}');
  });
  const proxies = [];
  const logs = [];
  const alerter = createAlerter(alertConfig({
    alertWebhook: fake.url, alertWebhookFormat: 'feishu', alertWebhookProxy: 'http://127.0.0.1:10002',
    alertTgToken: 'test-only', alertTgChatId: 'test-chat', alertProxy: 'http://127.0.0.1:10001',
  }, {}), {
    log: line => logs.push(line),
    // Redirect the Telegram send to our local fake; neither configured proxy is contacted.
    send: (url, payload, options) => {
      proxies.push(options.proxy);
      const target = url === fake.url ? fake.url : new URL('/telegram-test', fake.url).href;
      return postJson(target, payload, { requireCodeZero: options.requireCodeZero });
    },
  });
  assert.equal(await alerter.notify('fallback alert'), false);
  assert.deepEqual(proxies, ['http://127.0.0.1:10002', 'http://127.0.0.1:10001']);
  assert.equal(fake.requests.length, 2);
  assert.deepEqual(fake.requests[1].body, { chat_id: 'test-chat', text: '[vibe-relay] fallback alert', disable_web_page_preview: true });
  assert.equal(logs.length, 1);
});

test('an explicitly configured webhook proxy carries the request through CONNECT', async t => {
  const fake = await fakeServer(t, response => response.end('{"code":0}'));
  const proxy = http.createServer();
  const tunnels = [];
  const sockets = new Set();
  proxy.on('connect', (request, client, head) => {
    tunnels.push(request.url);
    // Always connect only to the local fake, regardless of the CONNECT target.
    const upstream = net.connect(fake.server.address().port, '127.0.0.1', () => {
      client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if (head.length) upstream.write(head);
      upstream.pipe(client); client.pipe(upstream);
    });
    sockets.add(client); sockets.add(upstream);
    client.on('error', () => upstream.destroy());
    upstream.on('error', () => client.destroy());
  });
  await new Promise(resolve => proxy.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => {
    for (const socket of sockets) socket.destroy();
    proxy.close(resolve);
  }));
  const alerter = createAlerter(alertConfig({
    alertWebhook: fake.url, alertWebhookFormat: 'feishu',
    alertWebhookProxy: `http://127.0.0.1:${proxy.address().port}`,
  }, {}));
  assert.equal(await alerter.notify('proxied alert'), true);
  assert.deepEqual(tunnels, [`127.0.0.1:${fake.server.address().port}`]);
  assert.equal(fake.requests.length, 1);
});

test('untrusted transport errors cannot leak URLs or credentials to alert logs', async () => {
  const logs = [];
  const alerter = createAlerter(alertConfig({ alertWebhook: 'http://127.0.0.1:1/test-only' }, {}), {
    send: async () => { throw new Error('http://127.0.0.1:1/test-only test-sensitive-marker'); },
    log: line => logs.push(line),
  });
  assert.equal(await alerter.notify('test'), false);
  assert.deepEqual(logs, ['[relay-alerts] webhook delivery failed: request failed']);
});

async function runTestAlert(settings = {}) {
  // Deliberately do not inherit real alert credentials, proxies, or Node options.
  return exec(process.execPath, ['server/relay-quality.js', '--test-alert'], {
    cwd: new URL('..', import.meta.url), timeout: 5000,
    env: { PATH: process.env.PATH, PANEL_RELAY_REGION: 'cn', ...settings },
  });
}

test('--test-alert sends exactly one test-prefixed message and exits without a server', async t => {
  const fake = await fakeServer(t, response => response.end('{"code":0}'));
  const result = await runTestAlert({ PANEL_RELAY_ALERT_WEBHOOK: fake.url, PANEL_RELAY_ALERT_WEBHOOK_FORMAT: 'feishu' });
  assert.match(result.stdout, /test alert delivered/);
  assert.equal(result.stderr, '');
  assert.equal(fake.requests.length, 1);
  assert.deepEqual(fake.requests[0].body, { msg_type: 'text', content: { text: '【x2v 告警·测试】 cn alert delivery test' } });
});

test('--test-alert exits nonzero on API rejection', async t => {
  const fake = await fakeServer(t, response => response.end('{"code":19001}'));
  await assert.rejects(runTestAlert({ PANEL_RELAY_ALERT_WEBHOOK: fake.url, PANEL_RELAY_ALERT_WEBHOOK_FORMAT: 'feishu' }), error => {
    assert.equal(error.code, 1);
    assert.match(error.stderr, /Feishu response code 19001/);
    assert.doesNotMatch(error.stderr, /127\.0\.0\.1|test-only/);
    return true;
  });
});

test('--test-alert exits nonzero when no channels are configured', async () => {
  await assert.rejects(runTestAlert(), error => {
    assert.equal(error.code, 1);
    assert.match(error.stderr, /no alert channels configured/);
    return true;
  });
});

test('unconfigured alerts remain disabled and cannot report delivery success', async () => {
  const alerter = createAlerter(alertConfig({}, {}), { log: quiet });
  assert.equal(alerter.enabled, false);
  assert.equal(await alerter.notify('test'), false);
});
