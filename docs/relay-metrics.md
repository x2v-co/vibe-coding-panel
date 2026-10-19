# Relay usage metrics and connection quality

Requested by 老板 on 2026-10-19: the closed beta needs user counts, and the Relay
needs connection-quality data and alerts for later tuning. Everything here is
**off by default** and anonymous: no login, no personal data.

## What is collected

| Source (in `server/relay.js`) | Metric |
| --- | --- |
| `POST /api/pair` forwarded to a computer and answered 2xx | `pairings` |
| Phone device cookie (`vibe_panel_device`) on a request the computer accepted (2xx, excluding `/api/health`) | `active_devices`, `new_devices`, `total_devices` |
| Computer uplink WebSocket `/relay/connect` | `sessions`, `active_connectors`, `new_connectors`, `total_connectors` |
| Upgrade attempts / refusals (auth, 409 conflict, capacity, admission, rate limit) | `connect_attempts`, `connect_failures` |
| WebSocket close | `disconnects`, `abnormal_disconnects`, `abnormal_disconnect_ratio`, `connection_duration_avg_s`, `connection_duration_p95_s` |
| Reconnect of the same computer within 30 min after an abnormal close | `reconnect_success_rate` |
| Heartbeat (30 s ping) without pong | `heartbeat_timeouts` |
| Ping→pong time | `rtt_avg_ms` |

Definitions:

- **Device** = one paired phone/browser (its device token). Re-pairing creates a
  new token and therefore a new device. Pairing itself happens on the computer;
  the Relay only sees the computer's answer.
- **Session** = one computer uplink. Reconnects within 30 minutes (network flap,
  Relay restart) continue the same session and are not counted again.
- **Abnormal close** = any close code other than 1000/1001, or a heartbeat timeout.
- **Connection duration** is per WebSocket connection (a session can span several).
- Days are Beijing days (Asia/Shanghai). Ratios/averages without data that day are
  empty in CSV and `null` in JSON.
- Counts are **per Relay node**. A phone that used both global and cn on one day is
  counted on each; do not add `active_devices` across regions as exact uniques.
- Best effort: a forged cookie is only counted if the computer accepted the request.

## Privacy and storage

Stored: counters, and keyed HMAC-SHA256 (truncated to 128 bits, hex) of the device
token and of the public connector id. Never stored: raw tokens or ids, IPs, user
agents, paths, request or message contents. The HMAC key is
`PANEL_RELAY_METRICS_SALT`; if unset, a random key is generated once and saved as
`metrics-salt` (mode 600) on the volume. Do not rotate or lose it, or every device
will look new. Use the same salt on both regions so hashes are comparable.

Layout of `PANEL_RELAY_METRICS_DIR` (`/data/metrics` in the container):

```text
daily/YYYY-MM-DD.csv     date,metric,value (today's file is refreshed every minute)
events/YYYY-MM-DD.jsonl  connection events, one JSON object per line
seen-devices.txt         one 32-char hash per line (ever seen), for new_devices
seen-connectors.txt      same for computers
state.json               today's in-progress counters and hash sets
metrics-salt             only when PANEL_RELAY_METRICS_SALT is unset
```

Size estimate: 33 bytes per device ever seen (10k devices ≈ 330 KB, 1M ≈ 33 MB),
~1 KB per day of CSV, `state.json` ≈ 35 bytes per distinct device/computer of the
day. Events are ~300–500 bytes each, about two per connection: 100 computers ×
20 reconnects/day ≈ 1.2 MB/day ≈ 36 MB for 30 days. Event files older than
`PANEL_RELAY_EVENT_RETENTION_DAYS` (default and minimum 30) are deleted at day
rollover. A crash loses at most one minute of counters; a normal stop flushes.

## Event log

```json
{"ts":"2026-10-19T09:00:00.000Z","region":"cn","event":"disconnect","conn":"<hmac>","session":"<uuid>","connection":"1a2b3c4d","close_code":1006,"reason":"","closed_by":"heartbeat_timeout","abnormal":true,"duration_ms":100000,"reconnects":0,"rtt_last_ms":60,"rtt_avg_ms":50,"rtt_max_ms":60,"requests":12,"latency_avg_ms":120,"latency_max_ms":800,"errors":0}
```

Events: `connect`, `reconnect` (with `gap_ms` and `reconnects`), `disconnect`,
`heartbeat_timeout`, `error` (socket error code, at most 3 per connection),
`connect_failed` (`status`, `reason`), `reconnect_failed` (no reconnect within 30
min after an abnormal close). `latency_*` is Relay→computer request time to the
first response frame. `closed_by` is `peer`, `heartbeat_timeout` or `relay_shutdown`.

## Read-only API

`GET /metrics/daily?from=YYYY-MM-DD&to=YYYY-MM-DD[&format=csv]` with
`Authorization: Bearer $PANEL_RELAY_METRICS_TOKEN`. Default range: last 30 days,
max 366. JSON: `{timezone, from, to, partial: [today], rows: [{date, metric, value}]}`.
Returns 404 unless both the metrics directory and the token are configured; 30
requests/minute per client.

## /healthz

Adds `region` and `connections: {current, disconnects_5m, abnormal_disconnects_5m, errors_5m}`
(errors = connect refusals, socket errors and heartbeat timeouts). Works even with
metrics off.

## Alerts

Evaluated every minute over a sliding window. An alert fires when, with at least
`MIN_EVENTS` samples, the abnormal-disconnect ratio or the connect-failure ratio
exceeds its threshold; it repeats after the cooldown while still high, and one
`recovered` message is sent afterwards. Messages are prefixed `[vibe-relay] <region>`.
Channels follow the existing aeeis notify pattern: Telegram bot + chat id, optional
generic JSON webhook, optional HTTP CONNECT proxy for hosts that reach Telegram only
through a proxy.

## Environment variables

| Variable | Default | Meaning |
| --- | --- | --- |
| `PANEL_RELAY_METRICS_DIR` | unset (off) | Persistent directory; enables metrics and event log. Use `/data/metrics` with the volume. |
| `PANEL_RELAY_METRICS_SALT` | generated | HMAC key, ≥16 chars, same on both regions. |
| `PANEL_RELAY_METRICS_TOKEN` | unset (API off) | Bearer token for `/metrics/daily`. |
| `PANEL_RELAY_EVENT_RETENTION_DAYS` | 30 | Event log retention (minimum 30). |
| `PANEL_RELAY_REGION` | from public URL | `global` or `cn`, written into events, alerts and `/healthz`. |
| `PANEL_RELAY_ALERT_TG_BOT_TOKEN` / `PANEL_RELAY_ALERT_TG_CHAT_ID` | unset | Telegram target (both required). |
| `PANEL_RELAY_ALERT_WEBHOOK` | unset | Optional JSON `{"text":...}` webhook. |
| `PANEL_RELAY_ALERT_PROXY` | unset | `http://host:port` CONNECT proxy for alert delivery (cn). |
| `PANEL_RELAY_ALERT_WINDOW_MIN` | 10 | Sliding window. |
| `PANEL_RELAY_ALERT_ABNORMAL_RATIO` | 0.3 | Abnormal disconnects / disconnects. |
| `PANEL_RELAY_ALERT_CONNECT_FAIL_RATIO` | 0.3 | Refused upgrades / attempts. |
| `PANEL_RELAY_ALERT_MIN_EVENTS` | 10 | Minimum samples in the window before alerting. |
| `PANEL_RELAY_ALERT_COOLDOWN_MIN` | 60 | Repeat interval while still firing. |

## Production rollout (SRE, per host; needs the approval card)

Merging only ships code: with the variables unset nothing is written and the
endpoint is 404. To enable, on each regional host (`/opt/vibe-regional`, global
`ubuntu@vibe-panel-relay`, cn `ubuntu@toolkit`):

1. Deploy an image built from this revision (the image pre-creates `/data/metrics`
   owned by `node`; the cn runtime image is rebuilt from
   `deploy/Dockerfile.regional-runtime`).
2. Update the compose file from `deploy/compose.regional.yml` (named volume
   `vibe_metrics` → `/data/metrics`). If you prefer a bind mount, create the host
   directory and `chown 1000:1000` it.
3. Add to the host `.env` (mode 600): `PANEL_RELAY_METRICS_DIR=/data/metrics`,
   `PANEL_RELAY_METRICS_SALT` (`openssl rand -hex 32`, same value on both hosts),
   `PANEL_RELAY_METRICS_TOKEN` (`openssl rand -hex 32`), `PANEL_RELAY_REGION`,
   and the alert variables (the compose files already pass them through). On cn,
   `PANEL_RELAY_ALERT_PROXY` must be reachable from the container: a proxy bound to
   the host's 127.0.0.1 is not; bind it on the docker bridge and use
   `http://host.docker.internal:<port>` (mapped via `extra_hosts`).
4. `docker compose up -d` recreates the container (one restart per host; Connectors
   reconnect automatically, in-flight streams may drop). Do one region at a time.
5. Verify `/healthz` shows `region` and `connections`, the metrics API answers with
   the token, and `events/` and `daily/` appear in the volume. Back up the volume
   (at least `metrics-salt` if generated, and `seen-*.txt`).

If the legacy `docker-compose.relay.yml` relay (container
`vibe-coding-panel-relay-1`) still serves traffic, apply the same variables there;
its compose file now declares the `relay_metrics` volume.
