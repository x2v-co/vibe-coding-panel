# Portable Connector

Download the ZIP for your operating system and processor from the GitHub Release,
verify its SHA256 against `SHA256SUMS`, then extract the entire folder. Do not run
from inside the ZIP. The package includes Node.js 24 LTS, application dependencies
and the built panel: no separate Node.js, npm, or npm install is needed.

- macOS Apple Silicon: `darwin-arm64`; Intel: `darwin-x64`. Double-click
  `Vibe Panel.command`. Packages are not notarized; macOS may require opening the
  launcher via Finder's context menu and allowing it in Privacy & Security. Do
  not disable Gatekeeper globally. If organizational policy blocks it, use the
  reviewed source installation or contact your administrator.
- Windows x64: double-click `Vibe Panel.bat`. These portable ZIPs are not signed
  MSI installers; follow your organization's policy for downloaded applications.
- Linux x64: run `bash "Vibe Panel.sh"`. Requires a contemporary glibc-based
  distribution supported by Node 24 (Ubuntu 22.04+ is tested); not Alpine/musl.

Install and log in to Codex CLI or Claude Code before starting. These third-party
agents are not included, and their subscriptions/usage limits still apply.
Voice is optional. On macOS, open `Setup Voice.command`; on Windows, open
`Setup Voice.bat`; on Linux, run `bash "Setup Voice.sh"`. This downloads a
checksum-verified uv bootstrap, managed Python 3.11, pinned Whisper dependencies,
bundled ffmpeg and the multilingual small model. Allow several minutes, internet
access to GitHub/PyPI/PyTorch/OpenAI model storage, and about 3 GB of free space.
The installer verifies model loading and ffmpeg before activating the environment.
Restart the Connector when it finishes. No global Python/pip or administrator
access is needed. Text input works without this optional installation.

Speech files live in `~/.vibe-panel/speech`, outside the extracted app, and survive
Connector updates. `PANEL_SPEECH_HOME` can select another directory. An interrupted
or failed install does not replace a previously working installation; rerunning
uses cached Python/packages/models. Explicit `PANEL_WHISPER_BACKEND` or
`PANEL_WHISPER_BIN` keeps your existing manual configuration (including MLX).
The automatic installer currently installs OpenAI Whisper on CPU, not MLX/CUDA;
speed depends on the computer. See `docs/configuration.md` for optional MLX and
automatic text correction privacy behavior. No audio is uploaded during setup.

To remove managed speech, stop the Connector and remove only its speech directory.
This does not remove device pairing. Older managed environments remain available
on disk after a successful reinstall; the active one is identified by
`speech/current.json`. Avoid moving a managed Python environment: rerun setup at
the desired location instead.

Keep the terminal open and computer awake. Scan the one-time pairing QR code with
your phone. The Connector does not start at login automatically. To stop it, press
Ctrl+C in its terminal. To run diagnostics, invoke the launcher with `--doctor
--json`; `bundle.json` identifies the source revision, platform and included Node.

To update or roll back, stop the Connector, extract another version to a new
folder and launch it. Pairing identity and devices live in `~/.vibe-panel`, not
inside the package, so they survive replacement. Do not copy this private state
into a package or share it. Delete the extracted application folder to uninstall;
remove pairing state separately only if you intend to revoke existing devices.

Android PWA core flows and native-terminal handoff to the tested Mac passed
physical acceptance. iPhone Safari core flows and home-screen launch/microphone
also passed; the remaining iPhone checks were paused by the tester. Real
interactive Windows/Linux handoff and clean phone reinstall remain unverified.
See [device results and known limitations](known-issues.md) for exact scope.
This remains an internal beta package.

Report issues: https://github.com/x2v-co/vibe-coding-panel/issues
Source and configuration: https://github.com/x2v-co/vibe-coding-panel

Bundled release information: `CHANGELOG.md`, `docs/known-issues.md`, and
`docs/native-session-handoff.md`. Read [privacy](https://vibe.tooluse.app/privacy/)
and [terms](https://vibe.tooluse.app/terms/); offline copies are included under
`dist/privacy/index.html` and `dist/terms/index.html`.
