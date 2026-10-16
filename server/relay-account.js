// Toolkit account login for the shared Relay (approved plan: vibe-panel is free,
// the Relay asks for a one-time toolkit login; local direct connection never does).
// toolkit hands back a short-lived HMAC assertion (opaque account subject + plan);
// the Relay turns it into its own long-lived signed cookie. No toolkit session,
// email or user id ever reaches the Relay.
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import express from 'express';
import { readCookie } from './pairing.js';

export const ACCOUNT_COOKIE = 'vibe_relay_account';
const STATE_COOKIE = 'vibe_relay_login_state';
const SESSION_MAX_AGE_S = 365 * 24 * 3600;

const sign = (secret, data) => createHmac('sha256', secret).update(data).digest('base64url');
const safeEqual = (a, b) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

export function relayAccountConfig(options = {}, env = process.env) {
  const mode = String(options.accountMode ?? env.PANEL_RELAY_ACCOUNT_MODE ?? 'off').toLowerCase() === 'required' ? 'required' : 'off';
  const toolkitSecret = String(options.toolkitSecret ?? env.PANEL_RELAY_TOOLKIT_SECRET ?? '');
  const toolkitOrigin = new URL(String(options.toolkitOrigin ?? env.PANEL_RELAY_TOOLKIT_ORIGIN ?? 'https://toolkit.fun')).origin;
  const sessionSecret = String(options.sessionSecret ?? env.PANEL_RELAY_SESSION_SECRET ?? '') || (toolkitSecret ? sign(toolkitSecret, 'vibe-relay-session') : '');
  if (mode === 'required' && toolkitSecret.length < 32) throw new Error('PANEL_RELAY_ACCOUNT_MODE=required needs PANEL_RELAY_TOOLKIT_SECRET (>= 32 chars).');
  return { mode, toolkitSecret, toolkitOrigin, sessionSecret };
}

export function verifyToolkitAssertion(token, { secret, audience, now = Date.now() }) {
  const [body, sig] = String(token || '').split('.');
  if (!body || !sig || !secret || !safeEqual(sig, sign(secret, body))) return null;
  let p; try { p = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')); } catch { return null; }
  if (p?.v !== 1 || p.aud !== audience || !(p.exp > now) || p.iat > now + 30000) return null;
  if (!/^[A-Za-z0-9_-]{43}$/.test(String(p.sub || ''))) return null;
  return p;
}

export function issueSession({ sub, plan }, secret, now = Date.now()) {
  const body = Buffer.from(JSON.stringify({ sub, plan: String(plan || 'free'), iat: now })).toString('base64url');
  return `${body}.${sign(secret, body)}`;
}

export function readSession(cookieHeader, secret) {
  if (!secret) return null;
  const [body, sig] = readCookie(cookieHeader, ACCOUNT_COOKIE).split('.');
  if (!body || !sig || !safeEqual(sig, sign(secret, body))) return null;
  try {
    const p = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    return /^[A-Za-z0-9_-]{43}$/.test(String(p.sub || '')) ? p : null;
  } catch { return null; }
}

const safeNext = value => {
  const raw = String(value || '');
  return raw.startsWith('/') && !raw.startsWith('//') && !raw.includes('\\') && raw.length <= 300 ? raw : '/app';
};

const CALLBACK_HTML = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><title>登录中 · Vibe Panel</title><body style="font:16px/1.8 system-ui,sans-serif;background:#f1f3ee;color:#1c211c;margin:0"><main style="max-width:600px;margin:60px auto;padding:0 24px"><h1>正在完成登录…</h1><p id="m">请稍候。</p></main><script>
(async()=>{const a=new URLSearchParams(location.hash.slice(1)).get('assertion')||'';const s=new URLSearchParams(location.search).get('state')||'';history.replaceState(null,'',location.pathname);
try{const r=await fetch('/relay/session',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({assertion:a,state:s})});const j=await r.json();if(!r.ok)throw new Error(j.error||'登录失败');location.replace(j.next||'/app');}
catch(e){document.getElementById('m').innerHTML=String(e.message||'登录失败').replace(/[<>&]/g,'')+'。<a href="/relay/login">重新登录</a>';}})();
</script></body></html>`;

/**
 * Installs /relay/login, /relay/callback and /relay/session and returns
 * `accountFor(req)` plus `requireAccount` middleware for proxied /api traffic.
 */
export function installRelayAccount(app, { config, audience, audit = () => {}, now = Date.now }) {
  const usedNonces = new Map();
  const cookie = (name, value, maxAge) => `${name}=${encodeURIComponent(value)}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${maxAge}`;
  const accountFor = req => readSession(req.headers.cookie, config.sessionSecret);

  app.get('/relay/account', (req, res) => {
    const account = accountFor(req);
    res.set('Cache-Control', 'no-store').json({ required: config.mode === 'required', loggedIn: !!account, plan: account?.plan || null });
  });
  app.get('/relay/login', (req, res) => {
    if (config.mode !== 'required') return res.redirect(safeNext(req.query.next));
    const state = randomBytes(24).toString('base64url');
    const next = safeNext(req.query.next);
    res.setHeader('Set-Cookie', cookie(STATE_COOKIE, `${state}|${next}`, 900));
    const url = new URL('/api/v1/vibe-relay/authorize', config.toolkitOrigin);
    url.search = new URLSearchParams({ return: audience, state }).toString();
    res.set('Cache-Control', 'no-store').redirect(url.toString());
  });
  app.get('/relay/callback', (_req, res) => {
    res.set({ 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'Content-Security-Policy': "default-src 'none'; script-src 'unsafe-inline'; connect-src 'self'; style-src 'unsafe-inline'" });
    res.type('html').send(CALLBACK_HTML);
  });
  app.post('/relay/session', express.json({ limit: '4kb' }), (req, res) => {
    const [state, next] = readCookie(req.headers.cookie, STATE_COOKIE).split('|');
    if (!state || state !== String(req.body?.state || '')) return res.status(400).json({ code: 'RELAY_LOGIN_STATE', error: '登录状态已过期，请重新登录' });
    const assertion = verifyToolkitAssertion(req.body?.assertion, { secret: config.toolkitSecret, audience, now: now() });
    for (const [key, until] of usedNonces) if (until <= now()) usedNonces.delete(key);
    if (!assertion || usedNonces.has(assertion.nonce) || usedNonces.size > 50000) {
      audit({ event: 'account_login_rejected' });
      return res.status(401).json({ code: 'RELAY_LOGIN_INVALID', error: 'toolkit 登录凭据无效或已过期，请重新登录' });
    }
    usedNonces.set(assertion.nonce, assertion.exp);
    res.setHeader('Set-Cookie', [
      cookie(ACCOUNT_COOKIE, issueSession(assertion, config.sessionSecret, now()), SESSION_MAX_AGE_S),
      cookie(STATE_COOKIE, '', 0),
    ]);
    audit({ event: 'account_login', plan: assertion.plan });
    res.set('Cache-Control', 'no-store').json({ ok: true, next: safeNext(next) });
  });

  const requireAccount = (req, res, next) => {
    if (config.mode !== 'required') return next();
    const account = accountFor(req);
    if (account) { req.relayAccount = account; return next(); }
    res.status(401).json({ code: 'RELAY_LOGIN_REQUIRED', error: '使用中继连接需要登录一次 toolkit 账号（支持 GitHub / 微信）。同一网络下的本地直连无需登录。', loginUrl: '/relay/login' });
  };
  return { accountFor, requireAccount };
}
