import { test, expect } from '@playwright/test';
const remote = '/api/desktop-controller/view';
async function fixture(page, { paired = true } = {}) {
  const state = { enabled: true, title: '验收会话', target: 'codex-app', bound: true, bindingId: 'fixture-binding', revision: 0, hasDraft: false, busy: false, local: false };
  const commands = [], audio = [], errors = [];
  let offline = false, failSend = false;
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/relay/config', r => r.fulfill({ json: { enabled: false } }));
  await page.route('**/api/**', async route => {
    const url = new URL(route.request().url()), p = url.pathname;
    if (p === remote || /\.(js|css)$/.test(p)) return route.continue();
    if (p === '/api/pair') {
      paired = route.request().postDataJSON().code === 'GOODCODE';
      return route.fulfill({ status: paired ? 200 : 400, json: paired ? { ok: true } : { error: '配对码无效' } });
    }
    if (p.endsWith('/speech/status')) return route.fulfill({ json: { enabled: true, ready: true } });
    if (p.endsWith('/status')) {
      if (offline) return route.abort();
      return route.fulfill({ status: paired ? 200 : 401, json: paired ? state : { error: '未配对' } });
    }
    if (p === '/api/transcriptions') { audio.push(route.request().postDataJSON()); return route.fulfill({ json: { text: '查看河北秦皇岛的天气' } }); }
    if (p.endsWith('/command')) {
      const body = route.request().postDataJSON(); commands.push(body);
      if (failSend && body.action === 'send') return route.abort();
      state.revision++; state.hasDraft = body.action !== 'send';
      return route.fulfill({ json: state });
    }
    if (p === '/api/health') return route.fulfill({ json: { pairingRequired: true, paired: false, providers: [] } });
    if (p === '/api/devices') return route.fulfill({ json: { devices: [] } });
    return route.fulfill({ status: 404, json: { error: `Unimplemented fixture: ${p}` } });
  });
  return { state, commands, audio, errors, offline: v => { offline = v; }, failSend: () => { failSend = true; } };
}
async function fits(page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(page.locator('#mic')).toBeInViewport();
  await expect(page.locator('#open-settings')).toBeInViewport();
  expect(await page.locator('#shell').evaluate(e => getComputedStyle(e).display)).not.toBe('block');
}
async function online(page) { await page.evaluate(() => window.dispatchEvent(new Event('online'))); }
test('public site switches language, persists it, and fits mobile pages', async ({ page }) => {
  for (const path of ['/', '/remote', '/download']) {
    await page.goto(path + '?lang=en');
    await expect(page.locator('.site-language')).toHaveText('中文');
    expect(await page.evaluate(() => ({ width: document.documentElement.scrollWidth, viewport: innerWidth, lang: document.documentElement.lang }))).toMatchObject({ lang: 'en' });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.locator('.site-language').click();
    await expect(page.locator('.site-language')).toHaveText('EN');
    await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN');
    await page.goto(path);
    await expect(page.locator('.site-language')).toHaveText('EN');
  }
});
test('fresh phone pairs in settings, normalizes pasted code, and stays paired after reload', async ({ page }) => {
  const f = await fixture(page, { paired: false }); await page.goto(remote);
  await expect(page.locator('#settings-sheet')).toBeVisible();
  await page.locator('#pair-code').fill('bad-code1'); await page.locator('#pair-submit').click();
  await expect(page.locator('#settings-connection-error')).toContainText('配对码无效');
  await page.locator('#pair-code').fill('ｇｏｏｄ－ｃｏｄｅ');
  await expect(page.locator('#pair-code')).toHaveValue('GOODCODE');
  await page.locator('#pair-submit').click(); await expect(page.locator('#settings-sheet')).not.toBeVisible();
  await page.reload(); await expect(page.locator('#mic')).toBeEnabled(); await fits(page);
  expect(f.commands).toEqual([]); expect(f.errors).toEqual([]);
});
for (const id of ['console','bar','matrix','hardware-tri','hardware-vibebar','hardware-five','hardware-aha','micro']) {
test(`phone template ${id} fits and persists; hardware keys stay on one row`, async ({ page }) => {
  const f = await fixture(page); await page.goto(remote); await expect(page.locator('#mic')).toBeEnabled();
    await page.locator('#open-settings').click(); await page.locator('#template-'+id).click(); await page.locator('#close-settings').click();
    await fits(page);
    if (['hardware-five', 'hardware-aha'].includes(id)) {
      const tops = await page.locator('.input-keypad > button:visible').evaluateAll(es => es.map(e => e.getBoundingClientRect().top));
      expect(tops.length).toBeGreaterThanOrEqual(4); expect(Math.max(...tops) - Math.min(...tops)).toBeLessThan(2);
    }
  await page.reload(); await page.locator('#open-settings').click(); await expect(page.locator('#template-'+id)).toHaveAttribute('aria-pressed','true');
  expect(f.errors).toEqual([]);
});
}
test('recorded segment becomes a computer draft, and send failure is never replayed on reconnect', async ({ page }) => {
  const f = await fixture(page);
  // Replace only the hardware boundary; exercise real FileReader, fetch and page handlers.
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'mediaDevices', { value: { getUserMedia: async () => ({ getTracks: () => [{ stop() {} }] }) } });
    window.MediaRecorder = class {
      static isTypeSupported() { return true; }
      constructor() { this.mimeType = 'audio/webm'; }
      start() { this.state = 'recording'; }
      stop() { this.state = 'inactive'; this.ondataavailable({ data: new Blob(['fixture-audio'], { type: this.mimeType }) }); this.onstop(); }
    };
  });
  await page.goto(remote); await page.locator('#mic').click(); await expect(page.locator('#mic')).toHaveAttribute('aria-label','结束录音并识别'); await page.locator('#mic').click();
  await expect(page.locator('#send')).toBeEnabled();
  expect(f.audio).toHaveLength(1); expect(f.audio[0].audio).toMatch(/^data:audio\/webm;base64,/);
  expect(f.commands.map(c => c.action)).toEqual(['append']); expect(f.commands[0].text).toBe('查看河北秦皇岛的天气');
  await expect(page.locator('#text')).toHaveValue('');
  f.failSend(); await page.locator('#send').click(); await expect(page.locator('#error')).not.toBeEmpty();
  await page.reload(); await expect(page.locator('#error')).toBeEmpty();
  expect(f.commands.map(c => c.action)).toEqual(['append','send']); expect(f.errors).toEqual([]);
});
test('offline recovery and target changes preserve unsent text without dispatch', async ({ page }) => {
  const f = await fixture(page); await page.goto(remote); await page.locator('#open-text').click(); await page.locator('#text').fill('保留这段文字'); await page.locator('#close-text').click();
  f.offline(true); await online(page); await expect(page.locator('#error')).not.toBeEmpty();
  f.offline(false); f.state.bindingId = 'new-target'; await online(page); await expect(page.locator('#error')).toBeEmpty();
  await expect(page.locator('#send')).toBeDisabled(); await expect(page.locator('#text')).toHaveValue('保留这段文字');
  await page.reload(); await expect(page.locator('#text')).toHaveValue('保留这段文字'); expect(f.commands).toEqual([]);
});
test('fresh panel fits mobile and remote redirect keeps connection query', async ({ page }) => {
  await fixture(page); await page.goto('/app'); await expect(page.locator('textarea').first()).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.goto('/app?next=controller&relay=fixture-identity'); await expect(page).toHaveURL(/desktop-controller\/view\?relay=fixture-identity/); await expect(page.locator('#mic')).toBeEnabled();
});
test('desktop control center loads CSS and managed console can collapse', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  const f = await fixture(page); Object.assign(f.state, { local: true, unified: true, target: 'claude-code' });
  await page.goto(remote);
  await expect(page.locator('#desktop-workspace')).toBeVisible();
  expect(await page.locator('.workspace-grid').evaluate(e => getComputedStyle(e).display)).toBe('grid');
  await expect(page.locator('#managed-console')).toBeVisible();
  await page.locator('#managed-console summary').click();
  await expect(page.locator('#managed-console')).not.toHaveAttribute('open', '');
  await page.locator('#managed-console summary').click();
  await expect(page.locator('#managed-console')).toHaveAttribute('open', '');
});
