import { randomBytes } from 'node:crypto';
import { deviceToken } from './pairing.js';

// Short-lived, one-use tickets transfer the existing device authorization.
// Device tokens never pass through URLs or browser JavaScript.
export function installRelayAuthorization(app, { store, origins, setCookie, now = Date.now }) {
  const tickets = new Map();
  const prune = () => { for (const [key, item] of tickets) if (item.expires <= now()) tickets.delete(key); };
  app.post('/api/relay-authorize', async (req, res) => {
    prune();
    const key = String(req.body?.ticket || '');
    const item = tickets.get(key);
    const audience = req.headers['x-vibe-relay-origin'];
    if (!item || item.target !== audience || !origins.includes(audience)) return res.status(401).json({ error: '节点授权已过期或不匹配' });
    tickets.delete(key);
    if (!await store.authenticate(item.token)) return res.status(401).json({ error: '设备授权已撤销' });
    setCookie(req, res, item.token);
    res.set('Cache-Control', 'no-store').json({ ok: true });
  });
  app.post('/api/relay-tickets', async (req, res) => {
    const token = deviceToken(req.headers.cookie);
    const device = await store.authenticate(token);
    if (!device || !origins.includes(req.headers['x-vibe-relay-origin'])) return res.status(401).json({ error: '请先配对此设备' });
    prune();
    // Limit outstanding tickets for each device and the entire connector.
    for (const [key, item] of tickets) if (item.deviceId === device.id) tickets.delete(key);
    if (tickets.size + origins.length > 400) return res.status(429).json({ error: '请稍后重试节点授权' });
    const result = origins.filter(origin => origin !== req.headers['x-vibe-relay-origin']).map(target => {
      const ticket = randomBytes(32).toString('base64url');
      tickets.set(ticket, { token, target, deviceId: device.id, expires: now() + 60000 });
      return { origin: target, ticket };
    });
    res.set('Cache-Control', 'no-store').json({ tickets: result });
  });
}
