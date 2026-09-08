# Install Vibe Coding Panel for a user

This guide is for Codex, Claude Code, or another coding agent that is asked to install Vibe Panel on the user's computer.

## 1. Inspect before changing anything

Detect the OS and shell. Run these checks from the user's requested project directory:

```bash
node --version
npm --version
codex --version
claude --version
```

Either Agent may be absent; only one working CLI is needed. Use Node.js 24 LTS for a new installation (Vite requires at least 20.19 or 22.12 on those release lines). Install missing prerequisites using the platform's supported installer or package manager; report any step requiring user interaction. Reuse the agent CLI that is already installed and authenticated. Do not overwrite its config, provider, model, credentials, or workspace settings.

If an existing Vibe Panel directory is present, inspect its `package.json`, `git status`, and `git remote` first. Preserve local changes and `.vibe-panel` state; use a separate folder if necessary. Do not clone over an existing installation or stop its active jobs. The current package must contain `connect` and `connect:relay` scripts. If the latest published checkout still lacks them, report an unpublished-package blocker instead of inventing scripts or claiming success.

## 2. Download and install

```bash
git clone https://github.com/x2v-co/vibe-coding-panel.git
cd vibe-coding-panel
npm install
```

If Git is unavailable, download and extract the [current ZIP](https://github.com/x2v-co/vibe-coding-panel/archive/refs/heads/main.zip). Never run from inside the ZIP preview. On Windows, use PowerShell commands rather than assuming Bash is installed. Run subsequent commands in the downloaded project folder. A frontend build is not required for the default shared Relay flow.

For voice input, install Whisper in a project-local virtual environment when Python 3.12 is available:

```bash
python3.12 -m venv .venv
.venv/bin/python -m pip install -U openai-whisper imageio-ffmpeg
```

Windows PowerShell:

```powershell
py -3.12 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -U openai-whisper imageio-ffmpeg
```

Reuse a working `.venv` instead of recreating it. Voice setup is optional. Text tasks must remain usable if Whisper is unavailable. Prefer this project-local environment to global Python changes. The first `small` model download is about 461 MB. The launcher locates `.venv` automatically; activation is not required.

Verify `.venv/bin/whisper --help` (Windows: `.\.venv\Scripts\whisper.exe --help`), not `--version`, which Whisper does not support. Use the same environment's Python to locate ffmpeg with `-c "import imageio_ffmpeg; print(imageio_ffmpeg.get_ffmpeg_exe())"`, then run the returned executable with `-version`. On PowerShell, invoke a quoted executable path with `&`.

## 3. Authenticate and choose the Agent

Check existing authentication first: `codex login status` or `claude auth status`. Only if login is needed, ask the user to complete `codex login` or `claude auth login`. Never log out a working account. Authentication status alone does not prove the configured model provider accepts requests. Run one harmless text request through the chosen CLI (may consume provider usage):

```bash
codex exec --skip-git-repo-check "Reply only PANEL_INSTALL_OK. Do not use tools or modify files."
# For Claude Code instead:
claude -p "Reply only PANEL_INSTALL_OK. Do not use tools or modify files."
```

Do not print tokens or copy credentials. If both CLIs are ready, follow the user's choice; otherwise use the one verified working CLI. If choosing Claude, create or merge `.vibe-panel/connector.json` with this value using your file editing tool:

```json
{"agentProvider":"claude"}
```

Use `codex` in that file to choose Codex. `PANEL_AGENT_PROVIDER` takes precedence over the file. Preserve unrelated fields. If the selected CLI fails, report that error without silently switching its model provider.

## 4. Start and verify

```bash
npm run connect
```

The launcher checks Agent availability, chooses a free local port, checks Whisper/ffmpeg, starts the local API, connects to the default shared Relay at `https://vibe.tooluse.app`, and prints a QR code and one-time pairing URL. Use a persistent terminal that will survive the agent's turn, preferably visible to the user. Keep this process running; do not start a duplicate Connector using the same identity. No account with Vibe Panel, personal Relay, Tailscale, or port forwarding is required.

Verify all of the following before reporting success:

- The log says `电脑 Connector 已连接`.
- `GET http://127.0.0.1:<printed-port>/api/health` returns `ok: true` and the selected provider is available/authenticated. PowerShell can use `Invoke-RestMethod`.
- The generated pairing URL includes `/app`, `relay`, and `pair`. Check the URL structure without exchanging the one-time code intended for the user. Keep pairing links private.
- If Whisper was installed, the log contains both `Whisper:` and `ffmpeg:` paths.

`/healthz` on the public Relay alone is not proof that this computer is connected. Report local Connector verification separately from the remaining phone check: the user scans the QR, selects Agent/workspace, sends a text request, then tries voice. Do not claim that phone pairing, microphone permission, or voice transcription was tested unless those checks actually ran. Let the user finish login and phone permissions themselves.

## 5. Handoff

Tell the user:

- Keep the terminal window and computer awake while using the phone.
- Scan the QR code, then choose Agent and workspace.
- Pairing codes expire after 10 minutes and can be regenerated by restarting the Connector.
- Stop with `Ctrl-C` after tasks finish; restart with `npm run connect` in the reported installation directory, or the matching `.command`/`.bat` launcher.
- The panel uses the user's existing Agent login and provider configuration.

Report the installation directory, selected Agent, actual port, voice readiness, QR/link, process lifetime, and any checks still awaiting the user. Avoid dumping environment variables, auth files, or other secrets.

If the user wants a private Relay, set `PANEL_RELAY_URL=https://relay.example.com` before `npm run connect` and use [the Relay deployment guide](relay-deployment.md). On PowerShell: `$env:PANEL_RELAY_URL='https://relay.example.com'; npm run connect`.
