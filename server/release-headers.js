// Installed PWAs have no visible reload button, so a cached service worker
// leaves users on stale code until they uninstall. The worker must always
// revalidate; the per-build release manifest must never be cached.
// Both GET and HEAD hit static files; send would otherwise stamp a default
// public,max-age=0 that an intermediary may treat as cacheable.
export const WECHAT_GROUP_QR_PATH = '/community/wechat-group-qr.png';

export function releaseCacheHeaders(req, res, next) {
  if (req.method === 'GET' || req.method === 'HEAD') {
    if (req.path === '/sw.js') res.setHeader('Cache-Control', 'no-cache');
    else if (req.path === '/version.json') res.setHeader('Cache-Control', 'no-store');
    // The WeChat group QR code is replaced weekly under the same path; always revalidate.
    else if (req.path === WECHAT_GROUP_QR_PATH) res.setHeader('Cache-Control', 'no-cache');
  }
  next();
}
