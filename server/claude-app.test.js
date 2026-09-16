import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { DesktopController } from './desktop-controller.js';
const exec = promisify(execFile);

test('Claude App accepts only verified session URL shapes, never home or foreign pages', { skip: process.platform !== 'darwin', timeout: 120000 }, async () => {
  const result = await exec('/usr/bin/swift', ['scripts/claude-desktop-controller.swift', '--self-test'], { timeout: 110000 });
  assert.match(result.stdout, /identity checks passed/);
});

test('Claude App binding retains Claude correction routing and rejects a changed native session', async () => {
  let changed = false;
  const controller = new DesktopController({ title: '', provider: 'claude', target: 'claude-app', driver: async request => {
    if (request.action === 'inspect') return { title:'Claude App · fixture',fingerprint:'session-one',text:'' };
    if (changed) throw new Error('目标会话已变化');
    return {};
  } });
  const state = await controller.bind({ current: true });
  assert.equal(state.provider, 'claude'); assert.equal(state.target, 'claude-app');
  changed = true;
  await assert.rejects(controller.command({ ...state,action:'append',text:'不会误写',eventId:'changed-target-001' }), /已变化/);
  assert.equal(controller.status().bound, false);
});

test('launcher rejects conflicting Claude target flags', async () => {
  await assert.rejects(exec(process.execPath, ['scripts/controller.mjs','--claude','--claude-app']), error => /一种外设目标/.test(error.stderr));
});
