// Read-only public preview monitor for the three managed Relay origins.
import assert from 'node:assert/strict';

const origins = (process.env.PANEL_RELAY_REGIONS || 'https://vibe.toolkit.fun,https://vibe-relay-cn.toolkit.fun,https://vibe-relay-global.toolkit.fun')
  .split(',').map(value => value.trim()).filter(Boolean);
const expected = process.env.PANEL_EXPECTED_REVISION || '';
const maxConnectorUse = Number(process.env.PANEL_MAX_CONNECTOR_USE || 0.9);
const maxInflightUse = Number(process.env.PANEL_MAX_INFLIGHT_USE || 0.9);

const results = await Promise.all(origins.map(async origin => {
  const response = await fetch(new URL('/healthz?monitor=1', origin), { signal: AbortSignal.timeout(10000), headers: { 'cache-control': 'no-cache' } });
  assert(response.ok, `${origin}: HTTP ${response.status}`);
  const health = await response.json();
  assert.equal(health.ok, true, `${origin}: unhealthy Relay`);
  if (expected) assert.equal(health.version, expected, `${origin}: expected ${expected}, got ${health.version}`);
  assert(['open', 'limited', 'paused'].includes(health.admission), `${origin}: invalid admission state`);
  const connectorUse = health.capacity?.connectors ? health.connectors / health.capacity.connectors : 0;
  const inflightUse = health.capacity?.inflight ? health.inflight / health.capacity.inflight : 0;
  assert(connectorUse <= maxConnectorUse, `${origin}: connector capacity ${Math.round(connectorUse * 100)}%`);
  assert(inflightUse <= maxInflightUse, `${origin}: inflight capacity ${Math.round(inflightUse * 100)}%`);
  return { origin, version: health.version, admission: health.admission, connectors: health.connectors, inflight: health.inflight, capacity: health.capacity };
}));

console.log(JSON.stringify({ ok: true, checkedAt: new Date().toISOString(), results }));
