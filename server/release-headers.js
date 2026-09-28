// Installed PWAs have no visible reload button, so a cached service worker
// leaves users on stale code until they uninstall. The worker must always
// revalidate; the per-build release manifest must never be cached.
export function releaseCacheHeaders(req, res, next) {
  if (req.method === 'GET') {
    if (req.path === '/sw.js') res.setHeader('Cache-Control', 'no-cache');
    else if (req.path === '/version.json') res.setHeader('Cache-Control', 'no-store');
  }
  next();
}
