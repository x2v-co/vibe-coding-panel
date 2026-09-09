# Configuration

Most users should use the default shared Relay and the launcher. These settings are for local development, private Relay operators, or troubleshooting.

| Variable | Default | Purpose |
| --- | --- | --- |
| `PANEL_RELAY_URL` | `https://vibe.tooluse.app` for `connect` | Connector Relay address |
| `PANEL_AGENT_PROVIDER` | `.vibe-panel/connector.json`, otherwise `codex` | `codex` or `claude`; environment overrides the file |
| `PANEL_CODEX_BIN` | `codex` | Codex executable |
| `PANEL_CLAUDE_BIN` | `claude` | Claude Code executable |
| `PANEL_API_PORT` | `8787` | `connect` tries fallback ports if occupied; `npm start` uses the configured port directly |
| `PANEL_WHISPER_BIN` | detected `whisper` | Whisper executable |
| `PANEL_PYTHON_BIN` | detected Python | Python used to find bundled ffmpeg |
| `PANEL_FFMPEG_BIN` | detected automatically | ffmpeg executable override |
| `PANEL_WHISPER_MODEL` | `small` | Whisper model name |
| `PANEL_WHISPER_TIMEOUT_MS` | `180000` | Transcription timeout |
| `PANEL_REQUIRE_PAIRING` | unset for `npm start`; enabled by Connector | Require pairing for non-loopback API requests |
| `PANEL_DEVICE_STORE` | `~/.vibe-panel/devices.json` | Local device authorization store |
| `PANEL_RELAY_STATE` | `~/.vibe-panel/relay.json` | Private Connector identity; never share its credential |
| `PANEL_CLAUDE_PERMISSION_MODE` | `acceptEdits` | Claude permission mode |

Set variables in the shell before launching. The Node launchers do not automatically load `.env`; Docker Compose uses it for Relay deployment.

## Local-only use / 纯本机

```bash
npm install
npm run build
npm start
```

Open `http://127.0.0.1:8787` on the agent computer. The built UI and API share one origin. This mode does not connect to the shared Relay. `npm start` requires explicit Whisper/Python paths if they are not on PATH; `.venv` auto-discovery belongs to `npm run connect`.

## Private Relay / 自建 Relay

macOS/Linux: `PANEL_RELAY_URL=https://relay.example.com npm run connect`.

PowerShell: `$env:PANEL_RELAY_URL='https://relay.example.com'; npm run connect`.

Use [the deployment guide](relay-deployment.md) to operate the server. Normal phone users can skip this section.

## Tailscale and advanced Bridge

For an existing Tailscale setup, run the built local service with `PANEL_REQUIRE_PAIRING=1`, then `tailscale serve --bg http://127.0.0.1:8787`. On the computer, open local Settings, enter the HTTPS URL printed by Tailscale under mobile pairing, and generate a QR code. Both devices must be signed into the appropriate tailnet. This path does not need the shared Relay.

To control an Agent on a different computer through the advanced Remote setting, start a Bridge there (macOS/Linux):

```bash
PANEL_BRIDGE_HOST=0.0.0.0 \
PANEL_BRIDGE_PORT=8788 \
PANEL_BRIDGE_TOKEN='replace-with-a-long-random-token' \
PANEL_AGENT_NAME='Studio PC' \
npm start
```

Keep the Bridge behind Tailscale/WireGuard or a trusted HTTPS proxy. Enter its HTTPS address, token, and workspace in the panel's Remote settings. Do not expose the Bridge directly to the Internet. `PANEL_AGENT_NAME` defaults to the hostname; the Bridge defaults to loopback port `8788` and is enabled only with a token.

`npm run share` is an optional temporary Cloudflare Tunnel helper and requires `cloudflared`; it is not needed for the default Connector flow.

## Useful commands

```bash
npm run connect       # normal phone Connector
npm run connect:relay # private Relay URL supplied with PANEL_RELAY_URL
npm run dev           # local Vite development mode
npm test              # tests
npm run check         # TypeScript checks
npm run build         # production frontend
```

### Apple Silicon speech recognition

The default speech backend remains OpenAI Whisper with the `small` model.
On an Apple Silicon Mac with `mlx-whisper` installed, select the accelerated
larger multilingual model with:

```sh
PANEL_WHISPER_BACKEND=mlx npm run connect
```

This uses `mlx_whisper` and `mlx-community/whisper-large-v3-turbo-q4` by default.
Set `PANEL_WHISPER_BIN` if that executable is outside PATH, and
`PANEL_WHISPER_MODEL` to select another compatible MLX model directory/repository.
The first run downloads model weights (about 464 MB for the default MLX model).
Pre-download and test the model locally before phone use; model download time may
exceed the Relay request deadline. The launcher prints the selected backend/model,
and `/api/health` reports them under `speech`. Audio still transcribes locally.
Windows, Linux and Intel Macs should use the default backend. The two CLIs use
different flag spellings; the Connector adapts the flags rather than requiring a
wrapper. Neither backend is given the expected transcript as a prompt.
