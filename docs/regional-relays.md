# Toolkit regional Relay deployment

## Domain ownership and topology

Keep Toolkit's existing apex/www, cn and staging sites unchanged. Names mentioned
in Toolkit designs (api, cdn, cos, mcp, registry) remain reserved for that product.
Vibe uses the `vibe-<service>-<region>` namespace:

| Host | DNS target | Proxy | Role |
| --- | --- | --- | --- |
| vibe.toolkit.fun | 82.157.206.149 | DNS only | Product, download and pairing entry, initially Beijing |
| vibe-relay-cn.toolkit.fun | 82.157.206.149 | DNS only | China service endpoint; initial internal node bj-01 |
| vibe-relay-global.toolkit.fun | 129.226.95.67 | DNS only initially | Global service endpoint |
| vibe-staging.toolkit.fun | Not provisioned | — | Reserved Vibe test environment |

Check the DNS console for conflicts (including wildcard/AAAA records) before
creating records. Publish AAAA only after testing IPv6. Start with TTL 300/Auto.
Cloudflare may remain the authoritative DNS provider; DNS-only records bypass
its HTTP proxy. The public product entry is initially a Beijing dependency;
regional health-aware DNS for that entry is a separate future rollout.
Confirm the new service's filing/access requirements with the current provider.

## Routing and authorization

Connectors maintain two outbound WebSockets with one identity. Each connection
owns its retry timer and inflight requests. Regional Relays do not forward
payloads to each other. The browser remains on the product origin, reads
`/relay/config`, and probes both nodes' `/api/health` with its public connector ID.
It prefers a reachable already-paired node, then latency, and stays there until
failure. The browser uses credentialed CORS restricted to explicit Vibe origins;
no wildcard Toolkit access is allowed.

Pair once with the existing one-use pairing code. The authenticated computer
issues 60-second, single-use, target-bound tickets to authorize standby hosts.
Tickets are redeemed via POST, never a URL, and set host-only HttpOnly cookies.
Tokens never reach browser JavaScript. Revocation at the computer invalidates all
nodes. Only Vibe's device cookie is forwarded; Toolkit login cookies are stripped.
Standby provisioning is retried opportunistically when health is read. If a node
was never provisioned before all authorized nodes become unreachable, pairing
again may be necessary. Cross-site private endpoints may encounter browser
third-party-cookie restrictions; the managed Toolkit nodes are same-site HTTPS.

Mutating API requests carry a unique ID and the computer's boot ID. Retries use
the same ID; the local server caches up to 1,000 results for ten minutes, at most
64 KiB per result. Pending/oversized responses report an explicit status without
re-executing. A changed boot ID prevents automatic replay after restart. Pairing
and authorization exchanges are not automatically replayed. SSE reconnects to
the selected region; the existing job snapshots and event IDs recover progress.
There is no cross-process deduplication: one Connector/local API owns a computer.

## Configuration

`PANEL_RELAY_URLS` is a comma-separated list of 1–4 HTTPS origins. Without an
override it defaults to the two Toolkit regional endpoints. `PANEL_RELAY_URL`
still selects a single private endpoint. `PANEL_RELAY_PUBLIC_URL` overrides
the QR entry; it defaults to the product origin for managed nodes, or the first
explicit endpoint for custom configurations. Endpoints are validated origins,
without credentials, paths or query strings. HTTP is only allowed on loopback.

Regional servers enable `PANEL_RELAY_ROUTING=1`, set `PANEL_RELAY_REGIONS` to the
trusted node list and set `PANEL_PRODUCT_ORIGIN`. `/relay/config` is uncached and
allows the browser list to be updated without reinstalling the frontend. Current
Connectors require an environment/config update to change their uplinks; no
untrusted remote endpoint discovery is performed with their credentials.

## Deployment and migration

Use `deploy/compose.regional.yml` beside the existing proxy, with an immutable
Relay image, its Docker network, exact proxy container IP and regional origin.
The service has a 256 MiB memory limit, 0.5 CPU limit and reduced initial capacity.
Its host port is loopback-only 8791. The public entry and China endpoint share
the same regional Relay process. Do not round-robin requests across independent
Relay processes: connector routing state is in process memory.

On Beijing `ubuntu@toolkit`, the existing proxy is `toolkit_cn-nginx-1`, network
`toolkit_cn_default`, with templates/certificates under
`/opt/x2v/toolkit_new/production-cn/nginx`. Add a separate Vibe template from
`deploy/nginx.vibe-cn.conf`; obtain a publicly trusted certificate for BOTH names
under `certs/vibe/`. Existing Toolkit certificates are Cloudflare Origin CA and
must not be reused for direct browser access. Bootstrap only the HTTP ACME
location until certificate issuance, then validate `nginx -t` before reload.
Configure renewal and reload without replacing Toolkit's certificate files.

On `ubuntu@vibe-panel-relay`, use network `vibe-coding-panel_default` and append
`deploy/Caddyfile.vibe-global` to the existing Caddy configuration after DNS is
ready. Caddy obtains/renews the public certificate. The global Relay is deployed
as its own service and is updated independently from the regional release script.

Order: build/test immutable artifact → start regional services privately → DNS
and public certificates → test HTTPS, WS, pairing and failover → distribute new
Connectors. Do not advertise a new default installer before both endpoints are
ready. Roll back by restoring the previous regional image. The supported public
topology is the product entry plus the China and global Relay endpoints listed
above.

Acceptance includes three mainland carriers without VPN, Wi-Fi/cellular switching,
computer VPN on/off, microphone upload, standby authorization, in-flight command
failure, revocation and SSE recovery. Automated local tests do not establish
mainland reachability or real iOS/Android behavior.

## Prepared deployment — 2026-09-11

Both hosts run `vibe-regional-vibe-regional-1` from `/opt/vibe-regional`, with
application revision `4a7865c220be7c51aad2a048606968706748c89a` and loopback port
8791. Existing Toolkit proxy routes have not been replaced.
Public activation is pending the three DNS records above and public certificates.
At verification time none of the three new names had an A answer.

Global uses the standard Node 24 Relay image. The host's Docker 29 legacy builder
produced an incomplete `docker save` archive, so Beijing uses its existing Node
22 Bookworm base with a prebuilt runtime bundle from the SAME global container.
`scripts/package-relay-runtime.mjs` copies the locked Express/WS dependency
closure (69 packages), server files and built frontend; it does not install or
fetch dependencies. `deploy/Dockerfile.regional-runtime` builds that bundle.
The transferred archive was verified on both hosts:

```text
runtime-4a7865c.tgz
sha256:12add8fca1db178112d723181ddbb8d790ba1c4ff9cd1fe40ad824c0f414bbd2
```

Validated: proxy-container access to each Relay; versioned internal health;
simultaneous WebSocket registration and request forwarding through both deployed
Relays with an isolated test identity; global forwarding after the China uplink
closes. No real Agent task was submitted during server smoke testing.

Local checks: 77 unit/integration tests passed, one platform-specific skip;
three launcher acceptance tests passed; TypeScript and production build passed.
A Chromium mobile viewport verified separate-host HTTPS pairing, automatic
standby authorization, unchanged page origin during failover and execution of a
fixture task afterward. Browser transport tests additionally cover ambiguous
write deduplication, computer restart and a blackholed request. Real mainland
carrier and mobile microphone validation remains pending public activation.

Staged proxy configurations are in `/opt/vibe-regional` on the respective hosts.
After DNS: install the China HTTP ACME route, issue a public certificate for
`vibe.toolkit.fun` and `vibe-relay-cn.toolkit.fun`, install the prepared HTTPS
template, configure renewal, validate and reload Nginx. On global, validate and
reload the prepared global Caddy configuration. Then
verify public HTTPS, WebSockets and pairing before distributing new Connectors.
New regional services are not yet attached to an automatic release updater.

## China public activation — 2026-09-11

The product and China records now point directly to `82.157.206.149`.
Both public HTTPS endpoints and WSS/API forwarding have passed verification.
Nginx's separate `vibe.conf.template` is installed; Toolkit's own template is
unchanged. Let's Encrypt issued certificate `vibe-panel-cn` for both names,
expiring 2026-12-10. Host Certbot's timer renews it using HTTP-01 webroot.
The root-owned deploy hook at
`/etc/letsencrypt/renewal-hooks/deploy/vibe-cn.sh` installs a versioned certificate
directory, switches the `certs/vibe` symlink and validates/reloads Nginx. The hook
source is `deploy/renew-vibe-cn-certificate.sh`; the bootstrap HTTP-only template
is retained as `deploy/nginx.vibe-cn.http.conf`.
Certbot's staging renewal dry run passed for both names, the renewal timer is
active, and the original Toolkit CN endpoint still returns 200.

Cloudflare warns because these DNS-only records expose an IP also used by the
proxied `cn.toolkit.fun`. This is expected for the direct China endpoint: its
traffic bypasses Cloudflare's proxy/WAF, and the shared origin IP is public.
Do not enable the proxy merely to suppress the warning. If hiding/isolation of
Toolkit's origin becomes a requirement, put Relay on a separate public IP;
origin access controls must be scoped so they do not block direct Vibe traffic.

At activation, `vibe-relay-global.toolkit.fun` was incorrectly set to the China
IP. Correct it to `129.226.95.67` before activating global TLS and distributing
the regional Connector release. The global service remains internally healthy.
