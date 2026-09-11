import http from 'node:http';
import { WebSocket } from 'ws';

// Each uplink owns its requests and retry timer. Losing one region must never
// cancel requests that are being served through the other region.
export class RelayConnector {
  constructor({ origin, connectorId, credential, apiPort, log = () => {} }) {
    Object.assign(this, { origin, connectorId, credential, apiPort, log });
    this.inflight = new Map();
    this.delay = 1000;
    this.stopped = false;
  }
  connect() {
    if (this.stopped) return;
    const url = new URL('/relay/connect', this.origin);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    url.searchParams.set('id', this.connectorId);
    const socket = this.socket = new WebSocket(url, {
      headers: { Authorization: `Bearer ${this.credential}` },
      maxPayload: 14 * 1024 * 1024, handshakeTimeout: 15000,
    });
    const send = message => { if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message)); };
    socket.on('open', () => { this.delay = 1000; this.log(`${this.origin}: connected`); });
    socket.on('message', raw => {
      let message; try { message = JSON.parse(raw); } catch { return; }
      if (message?.type === 'cancel') { this.inflight.get(message.requestId)?.destroy(); this.inflight.delete(message.requestId); }
      if (message?.type !== 'request') return;
      if (typeof message.path !== 'string' || !message.path.startsWith('/api/') || /[\r\n]/.test(message.path)) return;
      // The configured endpoint, not a browser-supplied header, is the audience
      // for a cross-node authorization ticket.
      const headers = { ...(message.headers || {}), host: `127.0.0.1:${this.apiPort}`, 'x-vibe-relay-origin': this.origin };
      const request = http.request({ host: '127.0.0.1', port: this.apiPort, method: message.method, path: message.path, headers }, response => {
        send({ type: 'response-start', requestId: message.requestId, status: response.statusCode, headers: response.headers });
        response.on('data', chunk => send({ type: 'response-chunk', requestId: message.requestId, data: chunk.toString('base64') }));
        response.on('end', () => { this.inflight.delete(message.requestId); send({ type: 'response-end', requestId: message.requestId }); });
        response.on('error', () => request.destroy());
      });
      this.inflight.set(message.requestId, request);
      request.on('error', error => { this.inflight.delete(message.requestId); send({ type: 'response-error', requestId: message.requestId, error: error.message }); });
      if (message.body) request.write(Buffer.from(message.body, 'base64'));
      request.end();
    });
    socket.on('error', error => this.log(`${this.origin}: ${error.message}`));
    socket.on('close', () => {
      for (const request of this.inflight.values()) request.destroy();
      this.inflight.clear();
      if (this.stopped) return;
      this.timer = setTimeout(() => this.connect(), this.delay + Math.random() * 500);
      this.delay = Math.min(this.delay * 2, 30000);
    });
  }
  stop() {
    this.stopped = true;
    clearTimeout(this.timer);
    this.socket?.terminate();
    for (const request of this.inflight.values()) request.destroy();
    this.inflight.clear();
  }
}
