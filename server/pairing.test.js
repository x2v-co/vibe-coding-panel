import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { PairingStore, readCookie } from './pairing.js';

test('pairing codes are one-time and device tokens survive restart', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'vibe-panel-pairing-'));
  const filePath = path.join(directory, 'devices.json');
  let now = 1_000;
  const random = (size) => Buffer.alloc(size, 7);

  try {
    const store = new PairingStore({ filePath, now: () => now, random });
    await store.init();
    const { code } = store.createCode();
    const paired = await store.exchange(code, { name: 'Test phone', userAgent: 'test' });

    assert.equal((await store.authenticate(paired.token))?.name, 'Test phone');
    await assert.rejects(() => store.exchange(code), /无效或已过期/);

    const restarted = new PairingStore({ filePath, now: () => now, random });
    await restarted.init();
    assert.equal((await restarted.authenticate(paired.token))?.id, paired.device.id);
    assert.equal(await restarted.revoke(paired.device.id), true);
    assert.equal(await restarted.authenticate(paired.token), null);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('expired pairing codes are rejected', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'vibe-panel-pairing-'));
  let now = 1_000;
  const store = new PairingStore({
    filePath: path.join(directory, 'devices.json'), codeTtlMs: 100, now: () => now,
    random: (size) => Buffer.alloc(size, 11),
  });

  try {
    const { code } = store.createCode();
    now += 101;
    await assert.rejects(() => store.exchange(code), /无效或已过期/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('cookie parser returns the requested decoded cookie', () => {
  assert.equal(readCookie('first=1; vibe_panel_device=hello%20world; last=3', 'vibe_panel_device'), 'hello world');
  assert.equal(readCookie('', 'vibe_panel_device'), '');
});
