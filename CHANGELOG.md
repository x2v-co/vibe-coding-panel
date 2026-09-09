# Changelog

Portable packages use package version 0.1.0 plus an exact Git revision. Each
`relay-<40-character revision>` GitHub Release identifies its source and ships
four Connector ZIPs, the Relay image, SHA256SUMS and version-specific notes.
The application remains an internal beta; see [known limitations](docs/known-issues.md).

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
