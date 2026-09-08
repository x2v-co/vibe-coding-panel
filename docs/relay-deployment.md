# Relay deployment

The Relay gives the phone a stable HTTPS address while the agent computer makes the only outbound connection. Users do not need ngrok, cloudflared, Tailscale, a public IP, or router configuration.

```text
Phone browser -- HTTPS/SSE --> Relay <-- WebSocket -- Desktop Connector --> Codex or Claude Code / Whisper
```

The Relay forwards request and response bytes in memory. It does not write prompts, code, recordings, images, or task results to disk. Device authorization remains on the agent computer.

## Server requirements

The initial target is Ubuntu 24.04, 2 vCPU, 4 GB RAM, 40 GB SSD, a public IPv4 address, and TCP ports 80/443. The defaults cap one Relay process at 100 connected computers and 100 in-flight HTTP/SSE requests. Measure production traffic before raising these limits.

## Deploy the Relay

Point a DNS A record such as `relay.example.com` at the server. Install Docker and the Compose plugin, then create a `.env` file beside `docker-compose.relay.yml`:

```dotenv
PANEL_RELAY_DOMAIN=relay.example.com
PANEL_RELAY_MAX_CONNECTORS=100
PANEL_RELAY_MAX_INFLIGHT=100
```

Start the service:

```bash
docker compose -f docker-compose.relay.yml up -d --build
curl https://relay.example.com/healthz
```

Caddy obtains and renews the HTTPS certificate automatically. The health response exposes only aggregate connection counts and configured capacity.

## Connect an agent computer

Normal users can use the shared Relay via the [README](../README.md). For your own Relay, install Node.js 24 LTS and sign in to at least one supported agent on macOS, Windows 10/11, or Linux. Then start the local service and outbound Connector together:

```bash
npm install
PANEL_RELAY_URL=https://relay.example.com npm run connect
```

On Windows PowerShell, use `$env:PANEL_RELAY_URL='https://relay.example.com'; npm run connect`.

The Connector checks the computer's own Codex or Claude Code login, creates a persistent private identity under the user's `.vibe-panel/relay.json`, and prints a one-time pairing QR code and URL automatically. Scan it on the phone, choose an available Agent and workspace, then send a text task. If only Claude Code is ready, set `PANEL_AGENT_PROVIDER=claude` or use the project-local default described in the README. Tasks execute through that computer's CLI; no local frontend build is required when the Relay serves the UI.

For local Whisper, set `PANEL_WHISPER_BIN`, `PANEL_PYTHON_BIN`, or `PANEL_FFMPEG_BIN` on the same command as needed. Keep the Connector process running while the phone is in use.

## Security boundary

- No user account or registration token is required. Each computer creates a private credential in its user home directory; its connector id is derived from that credential with SHA-256.
- The connector credential is sent only in the computer's WebSocket upgrade and is never placed in the phone URL.
- The phone URL contains only the connector id; the computer's local one-time pairing code still protects the panel.
- Phone pairing codes still expire after ten minutes and can be used once.
- The Relay never exposes a listening port on the computer and never receives filesystem access.
- A connector id can have only one active WebSocket. A second connection for the same id is rejected, preventing accidental cross-device replacement.
- Put account-level identity, abuse controls, and persistent metrics in place before operating this as a public multi-tenant service.
