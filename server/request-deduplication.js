import { createHash, randomUUID } from 'node:crypto';

export function requestDeduplication({ instanceId = randomUUID(), maxEntries = 1000, ttlMs = 10 * 60 * 1000, now = Date.now } = {}) {
  const entries = new Map();
  function middleware(req, res, next) {
    const key = req.headers['x-vibe-request-id'];
    if (!key || ['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
    if (req.headers['x-vibe-instance-id'] !== instanceId) return res.status(409).json({ code: 'CONNECTOR_RESTARTED', error: '电脑服务已重启，请先确认上次操作结果再重试。' });
    if (!/^[a-zA-Z0-9-]{16,80}$/.test(key)) return res.status(400).json({ error: 'Invalid request id' });
    const fingerprint = createHash('sha256').update(JSON.stringify([req.method, req.originalUrl, req.body, req.headers.cookie || ''])).digest('hex');
    for (const [id, item] of entries) if (item.done && item.expires < now()) entries.delete(id);
    const previous = entries.get(key);
    if (previous) {
      if (previous.fingerprint !== fingerprint) return res.status(409).json({ code: 'REQUEST_ID_CONFLICT', error: 'Request id already used' });
      if (!previous.done) return res.status(409).json({ code: 'REQUEST_PENDING', error: '上次操作仍在处理中，请等待结果，不要重复发送。' });
      return res.status(previous.status).set('Content-Type', previous.contentType).send(previous.body);
    }
    if (entries.size >= maxEntries) return res.status(503).json({ code: 'REQUEST_CACHE_FULL', error: '请求较多，请稍后重试' });
    const item = { fingerprint, done: false, expires: now() + ttlMs };
    entries.set(key, item);
    const originalJson = res.json.bind(res);
    res.json = body => {
      const serialized = JSON.stringify(body);
      const oversized = Buffer.byteLength(serialized) > 64 * 1024;
      Object.assign(item, { done: true, expires: now() + ttlMs, status: oversized ? 409 : res.statusCode, contentType: 'application/json', body: oversized ? JSON.stringify({ code: 'RESULT_NOT_REPLAYABLE', error: '操作已执行，请刷新查看结果，不要重复发送。' }) : serialized });
      return originalJson(body);
    };
    next();
  }
  return { instanceId, middleware };
}
