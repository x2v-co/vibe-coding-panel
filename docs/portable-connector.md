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
Whisper and ffmpeg are optional separate prerequisites for voice input; text input
works without them. See the repository's configuration guide for speech setup
and automatic text correction privacy behavior.

Keep the terminal open and computer awake. Scan the one-time pairing QR code with
your phone. The Connector does not start at login automatically. To stop it, press
Ctrl+C in its terminal. To run diagnostics, invoke the launcher with `--doctor
--json`; `bundle.json` identifies the source revision, platform and included Node.

To update or roll back, stop the Connector, extract another version to a new
folder and launch it. Pairing identity and devices live in `~/.vibe-panel`, not
inside the package, so they survive replacement. Do not copy this private state
into a package or share it. Delete the extracted application folder to uninstall;
remove pairing state separately only if you intend to revoke existing devices.

Known release gates: real-phone voice accuracy, iPhone/PWA reconnect acceptance,
and occupied native-terminal handoff still need verification. This is an internal
beta package, not a declaration that all product acceptance has passed.

Report issues: https://github.com/x2v-co/vibe-coding-panel/issues
Source and configuration: https://github.com/x2v-co/vibe-coding-panel
