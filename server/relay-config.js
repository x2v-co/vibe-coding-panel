export const PRODUCT_ORIGIN = 'https://vibe.toolkit.fun';
export const DEFAULT_RELAYS = ['https://vibe-relay-cn.toolkit.fun', 'https://vibe-relay-global.toolkit.fun'];

export function relayOrigin(value) {
  const url = new URL(value);
  if (url.protocol === 'wss:') url.protocol = 'https:';
  if (url.protocol === 'ws:') url.protocol = 'http:';
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) || url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    throw new Error('Relay addresses must be HTTPS origins (HTTP is allowed only on loopback).');
  }
  return url.origin;
}

export function connectorRelayConfig(env = process.env) {
  const values = env.PANEL_RELAY_URLS || env.PANEL_RELAY_URL;
  const origins = [...new Set(values ? values.split(',').map(value => relayOrigin(value.trim())) : DEFAULT_RELAYS)];
  if (!origins.length || origins.length > 4) throw new Error('Configure between one and four Relay origins.');
  const publicOrigin = relayOrigin(env.PANEL_RELAY_PUBLIC_URL || (values ? origins[0] : PRODUCT_ORIGIN));
  return { origins, publicOrigin };
}
