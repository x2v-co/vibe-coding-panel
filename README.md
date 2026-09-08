# Vibe Coding Panel

[简体中文](README.zh-CN.md) · [Website](https://vibe.tooluse.app/) · [Try the panel](https://vibe.tooluse.app/app)

Control your computer's Codex or Claude Code from your phone. Speak a request, choose a workspace, press a large key, and watch the result. No hardware required.

No Vibe Panel account, personal server, Tailscale, or tunnel setup is needed. The Connector runs on your computer and connects to the shared Relay at `https://vibe.tooluse.app`. Your agent keeps using its existing login and model provider.

## Install with your Agent

Paste this into Codex, Claude Code, or another coding agent **running on your computer**:

```text
Install and start Vibe Coding Panel on this computer.
Repository: https://github.com/x2v-co/vibe-coding-panel
Read docs/install-for-agents.md in the downloaded checkout and follow it.
Reuse my existing agent login and model/provider settings. Set up local
Whisper voice input if possible; report separately if it is unavailable.
Verify the Connector is online, then show me the phone pairing QR/link
and how to stop and restart it. Leave account login and phone microphone
permission to me. Do not report success until you have checked the service.
```

[Agent installation guide](docs/install-for-agents.md) covers platform checks, commands, existing installations, verification, and handoff.

## Install yourself

**Before you start:** use macOS, Windows 10/11, or Linux with [Node.js 24 LTS](https://nodejs.org/en/download). Install and sign in to [Codex CLI](https://developers.openai.com/codex/cli/) or [Claude Code](https://code.claude.com/docs/en/setup). Send a short text request in that CLI first to confirm it works.

1. **Download and extract** the [project ZIP](https://github.com/x2v-co/vibe-coding-panel/archive/refs/heads/main.zip). Open the extracted folder, not the ZIP.
2. **Start on your computer** using the launcher below. It installs Node dependencies on first launch.
3. **Scan the terminal QR code** with your phone camera. Open the link in Safari, Chrome, or Edge, then choose your Agent and workspace. Try a text request first.

| Computer | Start |
| --- | --- |
| macOS | Double-click `Vibe Panel.command` |
| Windows | Double-click `Vibe Panel.bat` |
| Linux | In the extracted folder, run `npm install`, then `npm run connect` |

Keep the terminal open and the computer awake. The phone can use a different network. Pairing codes expire after 10 minutes and can be used once; an already paired browser normally stays authorized.

Prefer a terminal? With Git installed, run:

```bash
git clone https://github.com/x2v-co/vibe-coding-panel.git
cd vibe-coding-panel
npm install
npm run connect
```

If the downloaded copy has no launcher or reports `Missing script: "connect"`, it is an older package. See [troubleshooting](#troubleshooting); do not create an empty replacement script.

## Enable voice input

Text input works without Python. For voice, install [Python 3.12](https://www.python.org/downloads/) and run the following **inside the project folder**, once.

macOS / Linux:

```bash
python3.12 -m venv .venv
.venv/bin/python -m pip install -U openai-whisper imageio-ffmpeg
```

Windows PowerShell:

```powershell
py -3.12 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -U openai-whisper imageio-ffmpeg
```

Restart the Connector. It detects this environment without activation; the log should show both `Whisper:` and `ffmpeg:` paths. No separate system ffmpeg installation is required. Linux may need its distribution's Python venv package.

Whisper downloads the `small` model (about 461 MB) on first transcription, so the first request takes longer. On the phone, allow this site's microphone, tap **VOICE INPUT**, speak, then tap again to finish. The transcript fills the draft; press **SEND** to run it. If browser recording fails, use the system audio upload option.

## Choose an Agent

Select Codex or Claude Code in the phone panel. To remember a default for double-click launches, create `.vibe-panel/connector.json` in the project:

```json
{"agentProvider":"claude"}
```

Use `codex` to switch back. This file is ignored by Git. `PANEL_AGENT_PROVIDER`, if set, takes precedence. Panel uses the CLI's existing credentials and provider configuration; CLI authentication failures must be resolved there.

## Runtime screenshots

<p align="center">
  <img src="docs/screenshots/runtime/panel-desktop.png" alt="Vibe Panel desktop runtime with Micro layout" width="72%" />
  <img src="docs/screenshots/runtime/panel-mobile.png" alt="Vibe Panel mobile runtime" width="24%" />
</p>

## Features and limits

- Large controls, mobile focus mode, text/voice input, image uploads, and workspace directory selection.
- Codex and Claude Code tasks with live output, stop, follow-up, and browser history.
- Eight key layouts, four color themes, and custom Micro key actions, labels, colors, and SVG icons.
- Micro voice key: hold to talk and release to transcribe; double-tap within 350 ms to latch recording, then press again to stop.
- Demo mode and installable HTTPS PWA. Demo mode does not execute real tasks.
- One-time pairing and device revocation from local Settings.

Micro's native Fast mode, approval/decline, session fork, and plan mode are not implemented by the current CLI adapter. Those controls report their limits. Screen capture depends on desktop browser support; phones can upload images. Browser history does not guarantee session recovery after a Connector restart.

## Troubleshooting

| Symptom | What to do |
| --- | --- |
| Launcher will not open on macOS | Open Terminal in the extracted folder and run `bash "Vibe Panel.command"`. |
| `node` / `npm` not found | Install Node.js 24 LTS, close and reopen the terminal, then retry. |
| `Missing script: "connect"` | Confirm the folder's `package.json` contains a `connect` script. Download a current Connector package; if the published copy still lacks it, report the packaging issue. |
| No Agent ready / authorization error | Run `codex` or `claude` directly and confirm a real text request succeeds. Panel reuses that configuration. |
| Phone says Connector offline | Keep the Connector running and the computer awake; wait for “电脑 Connector 已连接”, then scan its QR code. |
| QR code expired | Restart the Connector to get a fresh code. Existing paired browsers do not need to pair again. |
| Whisper or ffmpeg missing | Complete the voice setup above and restart. A Python virtual environment does not need activation. |
| Voice changes are not visible | Finish any running task, restart the computer Connector, and reload the phone page. |

## Privacy

The Agent and Whisper run on your computer. With the default shared Relay, prompts, recordings, images, and results pass through that Relay in memory; the Relay implementation does not persist those payloads. This is **not end-to-end encryption**: trust the Relay operator, or [host your own](docs/relay-deployment.md). Your model provider still receives the data sent by your Agent.

Browser history and preferences are stored locally. Device authorization hashes stay on the computer; pairing cookies authorize the phone. Revoke unrecognized devices in local Settings. See [SECURITY.md](SECURITY.md).

## Advanced use and development

For local-only use, Tailscale/Bridge, or environment variables, see [configuration](docs/configuration.md). Server operators can use the [Relay deployment guide](docs/relay-deployment.md). Normal users can use the shared Relay.

```bash
npm run dev
npm test
npm run check
npm run build
```

Development: open the Vite URL printed in the terminal (normally `http://localhost:5178`). This is separate from the phone Connector flow.

[Contributing](CONTRIBUTING.md) · [Changelog](CHANGELOG.md) · [Product/release context](docs/brand-led-release-route.md) · [MIT license](LICENSE)

Not affiliated with or endorsed by OpenAI, Codex, Anthropic, or Claude Code.
