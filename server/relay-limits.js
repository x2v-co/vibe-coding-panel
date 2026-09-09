// Fixed windows with a bounded key table. Saturation fails closed.
export function createLimiter({ windowMs = 60000, maxKeys = 10000, now = Date.now } = {}) {
  const entries = new Map();
  return (key, limit) => {
    const time = now();
    let entry = entries.get(key);
    if (!entry || entry.until <= time) {
      if (entries.size >= maxKeys) {
        for (const [id, item] of entries) if (item.until <= time) entries.delete(id);
        if (entries.size >= maxKeys && !entries.has(key)) return Math.ceil(windowMs / 1000);
      }
      entry = { count: 0, until: time + windowMs };
      entries.set(key, entry);
    }
    entry.count += 1;
    return entry.count > limit ? Math.max(1, Math.ceil((entry.until - time) / 1000)) : 0;
  };
}
