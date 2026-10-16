# Relay load test

`npm run loadtest:relay -- [--steps 100,250,500,1000,2000] [--rps 0.5] [--duration 15] [--account-rate 60] [--out result.json]`

- Default: spawns a temporary loopback relay (`PANEL_RELAY_ACCOUNT_MODE=required`, random test secret) and samples its RSS/CPU from `/proc`.
- `--target https://<staging relay>`: staging / temporary hosts only; production hostnames and IPs are refused. CPU/RSS then come from host monitoring; the rate-limit check needs `PANEL_LOADTEST_SESSION_SECRET` (the staging relay's session secret, provided via env, never committed).
- Measures per-connector memory/CPU, the largest step within the SLO (p99 <= 1 s, errors <= 1 %), drop-and-reconnect of 20 connectors, and per-account limiting (limited account gets `RELAY_ACCOUNT_LIMITED`, another account unaffected, no login -> 401).

## First run (2026-10-17, temporary loopback relay, 8 vCPU box, Node 20, 0.5 req/s per phone, 2 KB responses)

| connectors | req | errors | p50 | p99 | RSS | CPU (1 core = 100 %) |
| --- | --- | --- | --- | --- | --- | --- |
| 100 | 752 | 0 % | 2.2 ms | 4.6 ms | 81.5 MB | 6.5 % |
| 250 | 1868 | 0 % | 1.4 ms | 4.6 ms | 111.4 MB | 10.5 % |
| 500 | 3719 | 0 % | 1.2 ms | 4.6 ms | 115.7 MB | 13.0 % |
| 1000 | 7455 | 0 % | 1.2 ms | 6.7 ms | 120.1 MB | 20.6 % |
| 2000 | 15010 | 0 % | 1.4 ms | 9.8 ms | 164.4 MB | 34.4 % |

Idle RSS 72.5 MB; about 47 KB and 0.017 % CPU per connector at this load. Reconnect: 20/20 back in <= 3.7 ms, no 409, traffic flows after reconnect. Per-account limit (60/min in test): 60 allowed, then `RELAY_ACCOUNT_LIMITED`; other account 200; no login 401.

Not covered yet: TLS, real network, the production container caps (0.5 CPU / 256 MiB), SSE event streams, and domestic end-to-end latency via the Beijing entry. Those need a staging run on a relay host (SRE).
