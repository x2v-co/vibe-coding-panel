# Changelog

Portable packages use package version 0.1.0 plus an exact Git revision. Each
`relay-<40-character revision>` GitHub Release identifies its source and ships
four Connector ZIPs, the Relay image, SHA256SUMS and version-specific notes.
The application remains an internal beta; see [known limitations](docs/known-issues.md).

## 2026-09-10 — Android clean reinstall acceptance

- Record independent OPPO Android PWA uninstall/site-data cleanup, fresh pairing,
  reinstall, home-icon launch without re-pairing and a successful Codex task.
- Preserve the distinction between this reinstall check and earlier Android
  voice/photo/stop/recovery passes; remaining iPhone acceptance stays paused.

## 2026-09-10 — incomplete Claude ownership metadata

- Keep continuation blocked when a live Claude PID file is empty, partially
  written or invalid, or its ownership directory cannot be inspected. Previously
  these states could appear released. Valid unrelated sessions and stale files
  for exited processes still allow continuation.
- Add regression coverage for temporary metadata writes and safe recovery.

## 2026-09-10 — Linux terminal handoff

- Fix Claude remote release on Linux: compare its recorded kernel start ticks
  against the current process instead of expecting a macOS date string. Keep
  process-name and birth-time checks, and reject stale identities.
- Add Ubuntu 24.04 PTY acceptance for Codex 0.153.4 and Claude 2.1.266:
  interactive replies, occupied state, remote release with actual terminal exit
  and same-ID continuation against an isolated local model fixture.

## 2026-09-10 — Windows interactive terminal acceptance

- Gate releases on real Windows Server 2025 ConPTY terminal tests for Codex
  0.153.4 and Claude Code 2.1.266, using isolated homes and a local model fixture.
- Verify interactive replies, preserved context, occupied/released state,
  refusal of remote termination, normal terminal exit and same-ID continuation.
- Dispose owned ConPTY resources after exit so acceptance completes cleanly.
  Physical Windows 11 UI and real-provider accounts remain unverified.

## 2026-09-10 — mobile acceptance and controller fixes

- Align Codex Micro defaults and configurable controls with official documentation;
  restore the reference hardware appearance and add dial/stick feedback.
- Keep mobile layouts within the viewport, preserve input beside image previews,
  and place copy/settings actions inline. Lock outer scrolling while retaining
  internal content scrolling.
- Restore connection state automatically after network loss and foregrounding.
- Keep stopped status visible on narrow screens and refresh after stop requests.
- Fit controls above Safari's toolbar, including removal of the inherited
  minimum height that overrode the visible viewport.
- Record Android PWA core acceptance, both agents' same-session handoff to Mac,
  iPhone Safari core acceptance and limited iPhone home-screen-app checks.
  [Device results](docs/known-issues.md) distinguish passes from untested scope.

## 2026-09-10 — actionable failure guidance

- Handle proxy HTML and malformed API responses without exposing JSON parser errors.
- Explain Connector offline/timeout, revoked pairing, request limits and upload size,
  including checking existing tasks before resending after an uncertain response.
- Distinguish missing CLI, provider authentication/quota/network and incompatible
  CLI arguments from phone pairing failures.
- Classify speech installation, model download, memory, permissions and timeout
  failures; invalid optional speech configuration keeps text mode operational.
- Add HTTP fault acceptance for missing CLI, quota failure and invalid speech
  configuration, plus browser/API response tests and accessible error announcements.

## 2026-09-10 — release documentation

- Publish privacy and terms pages, accessible before pairing and from the panel.
- Correct the homepage data-locality claim and explain Relay forwarding,
  correction before SEND, persistent browser history and screenshots.
- Update download/setup guidance and ship changelog, known issues and recovery
  documentation inside the portable packages.
- Generate each release's commit list from the previous published release,
  together with supported downloads, validation scope, limitations and feedback.

## 2026-09-10 — voice setup and diagnostics

- `fea51ea`: force UTF-8 in managed speech to work on Windows locales.
- `a2adec0`: Setup Voice installs isolated managed Python, Whisper, ffmpeg and
  a verified model; four extracted-package CI jobs perform real setup/transcription.
- `46c7629`: embed the release revision in Docker-built frontend assets.
- `b8d543c`, `d810512`: paired runtime diagnostics, optional speech status and
  refresh-first guidance for different web/Connector versions.
- `8d0659a`: explicit native handoff states, workspace/process identity checks,
  observed ownership loss before success, and safe refusal of shared daemons.

## 2026-09-09 — portable runtime and release infrastructure

- `68b9c05`: portable macOS ARM/Intel, Windows x64 and Linux x64 ZIPs include
  verified official Node 24 and locked app dependencies; extracted-package CI.
- `4235e1`: automatically correct speech transcripts into the existing editable
  draft, preserve raw text on failure and preserve user edits during processing.
- `10dcc27`: optional MLX speech backend and compatible CLI flags.
- `bfde7eb`: explicit stop remains stopped when the CLI exits nonzero on SIGINT.
- `fd84c68`: unified launcher/doctor, clean-platform acceptance, Relay pairing
  protections/rate and body limits/timeouts, versioned deployment and rollback.

## [0.1.0] - 2026-09-04

### Added

- Try the panel in a no-login demo mode before connecting an agent.
- Pair a phone with a computer using an expiring one-time code or QR code.
- Review authorized devices and revoke access from the local control panel.
- Run the panel through an HTTPS Cloudflare Tunnel with `npm run share`.
- Publish the local/remote security boundary, privacy behavior, and contribution policy.

### Changed

- Make the open-source repository metadata, license, CI checks, and release guidance public-ready.
- Keep remote Bridge tokens as an advanced connection path while pairing protects public phone access.
