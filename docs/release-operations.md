# Release operations

## First run

Install Node.js 24 LTS. Run `Vibe Panel.command` (macOS), `Vibe Panel.bat`
(Windows), or `bash "Vibe Panel.sh"` (Linux). All use `scripts/launch.mjs`;
missing packages are installed with `npm ci`. Already installed: `npm run connect`.
Run `node scripts/launch.mjs --doctor --json` without installing dependencies
for machine-readable Node/npm/dependency/agent-login/port diagnostics.
An unavailable Whisper/ffmpeg installation retains text input. These are source
launchers, not bundled desktop installers; Node and an authenticated agent are
still required.

CI uses clean macOS, Windows and Linux runners with Node 24, runs the doctor
before/after dependency availability, exercises missing and authenticated fixture
agents with paths containing spaces, occupies a port to test fallback, then
launches a Connector, pairs through a local Relay and executes a fixture task.
This checks process integration without real accounts; it does not certify all
upstream CLI versions, real phone microphone access, or platform installers.

## Relay protection

| Environment variable | Default | Meaning |
| --- | --- | --- |
| PANEL_RELAY_MAX_UPLOADS | 8 | Concurrent bodies being parsed, before forwarding |
| PANEL_RELAY_RATE_LIMIT | 120 | API requests per client per minute |
| PANEL_RELAY_PAIR_LIMIT | 10 | Pair attempts per client per 10 minutes; target limit is 3x |
| PANEL_RELAY_MAX_BODY_BYTES | 10485760 | Raw API body cap, including base64 audio overhead |
| PANEL_RELAY_REQUEST_TIMEOUT_MS | 60000 | Non-stream request deadline |
| PANEL_RELAY_STREAM_TIMEOUT_MS | 600000 | Event stream deadline; browser reconnects |
| PANEL_RELAY_PER_CONNECTOR_INFLIGHT | 20 | Inflight requests per computer |
| PANEL_RELAY_MAX_INFLIGHT | 100 | Global inflight limit |
| PANEL_RELAY_MAX_CONNECTORS | 100 | Connected computers |
| PANEL_RELAY_TRUST_PROXY | unset | Exact immediate proxy socket IP allowed to supply XFF |

Rate limits and the upload concurrency cap run before parsing bodies; socket send buffers are also capped. Compressed bodies are rejected. HTTP
uploads have a 30-second deadline and headers 15 seconds. WebSocket registration
is limited to 30 attempts/minute/client and requires a bearer credential (query
credentials are no longer accepted). Rate tables are bounded and fail closed at
capacity. Disconnects and deadlines cancel forwarded work. Slow response consumers
are disconnected rather than allowed unbounded buffering. Audit events contain
no bodies, pairing codes or credentials. Limits reset on process restart; they
are per-process and require a shared store before scaling to multiple replicas.
Caddy trusts only listed Cloudflare network ranges, replaces upstream XFF with the
resolved client IP, and Relay trusts only that Caddy container's discovered IP.
Update those ranges when Cloudflare changes them.

## Automated release

After all three CI jobs pass on main, CI builds `vibe-panel:<full-commit-sha>`,
publishes `relay-image.tar.gz` and `SHA256SUMS` on a `relay-<sha>` GitHub Release,
and waits for the public health endpoint to report that SHA. The production
systemd timer polls only this repository's latest release every two minutes.
It verifies SHA256 before Docker load, serializes deployment with flock, records
the previous image digest, health-checks both local and public endpoints and
restores the previous image on failure. Release packages contain only the image;
private deployment notes are excluded from Docker's context and copy allowlist.
Checksums provide integrity; repository release write access is the trust boundary.

Bootstrap on the host: install the tracked deploy scripts, Compose files and
Caddyfile under `/opt/vibe-coding-panel`, then install `vibe-panel-update.service`
and `.timer` under `/etc/systemd/system` and run `systemctl enable --now
vibe-panel-update.timer`. Docker Compose, curl, Python 3 and flock are required.
The updater requires outbound HTTPS; no public SSH key or self-hosted CI runner
is needed. Keep Docker images needed for rollback; do not prune them blindly.

Inspect `journalctl -u vibe-panel-update.service` and `/healthz` for version and
capacity. To roll back, run `sudo bash deploy/rollback.sh`. The last-release marker
prevents the timer immediately reapplying that same release. To deliberately
retry it, remove `deploy/last-release` and `deploy/failed-release` if present, then start the updater. Failed releases are quarantined to avoid repeated automatic switch/rollback loops. Stop the timer to
freeze releases. For a manual restart use `docker compose --env-file .env
--env-file deploy/image.env -f docker-compose.relay.yml -f deploy/image.yml up -d`.
A release restarts Relay; paired Connectors automatically reconnect, but inflight
HTTP streams can be interrupted. Local agent tasks remain on their computers.
