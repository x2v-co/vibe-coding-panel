#!/usr/bin/env bash
# Run on the Relay host. Argument is an immutable local Docker image reference.
set -euo pipefail
image=${1:?Usage: apply-release.sh IMAGE}
[[ "$image" =~ ^vibe-panel:[a-zA-Z0-9._-]+$ ]] || { echo 'Invalid image reference'; exit 1; }
cd "${PANEL_DEPLOY_ROOT:-/opt/vibe-coding-panel}"
exec 9>deploy/deploy.lock
flock -w 120 9
compose=(docker compose -f docker-compose.relay.yml -f deploy/image.yml)
old=$(docker inspect vibe-coding-panel-relay-1 --format '{{.Image}}')
version=$(docker image inspect "$image" --format '{{index .Config.Labels "org.opencontainers.image.revision"}}')
[[ -n "$version" ]] || { echo 'Missing image revision'; exit 1; }
# Resolve the immediate proxy IP rather than trusting arbitrary forwarding headers.
export PANEL_RELAY_TRUST_PROXY=$(docker inspect vibe-coding-panel-caddy-1 --format '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}')
export PANEL_RELAY_IMAGE="$image"
rollback() {
  echo "Deployment failed; restoring $old"
  export PANEL_RELAY_IMAGE="$old"
  "${compose[@]}" up -d --no-build --no-deps relay
  docker exec vibe-coding-panel-caddy-1 caddy reload --config /etc/caddy/Caddyfile
  docker inspect vibe-coding-panel-relay-1 --format '{{.Image}}' | grep -Fx "$old"
  for attempt in $(seq 1 15); do
    if docker exec vibe-coding-panel-relay-1 node -e 'fetch("http://127.0.0.1:8789/healthz").then(r=>r.json()).then(x=>process.exit(x.ok?0:1)).catch(()=>process.exit(1))'; then return 0; fi
    sleep 2
  done
  echo 'Rollback container did not become healthy' >&2
  return 1
}
trap rollback ERR
"${compose[@]}" up -d --no-build --no-deps relay
healthy=false
for attempt in $(seq 1 30); do
  actual=$(docker exec vibe-coding-panel-relay-1 node -e 'fetch("http://127.0.0.1:8789/healthz").then(r=>r.json()).then(x=>{if(!x.ok)process.exit(1);console.log(x.version)})' 2>/dev/null || true)
  if [[ "$actual" == "$version" ]]; then healthy=true; break; fi
  sleep 2
done
[[ "$healthy" == true ]]
# Container replacement can change its IP; refresh Caddy's upstream resolution.
docker exec vibe-coding-panel-caddy-1 caddy reload --config /etc/caddy/Caddyfile
public=$(curl --fail --silent --show-error --retry 5 --retry-delay 2 "https://vibe.tooluse.app/healthz?release=$version")
node_version=$(printf '%s' "$public" | python3 -c 'import json,sys; d=json.load(sys.stdin); assert d["ok"]; print(d["version"])')
[[ "$node_version" == "$version" ]]
trap - ERR
printf '%s\n' "$old" > deploy/previous-image
printf '%s\n' "$image" > deploy/current-image
printf 'PANEL_RELAY_IMAGE=%s\nPANEL_RELAY_TRUST_PROXY=%s\n' "$image" "$PANEL_RELAY_TRUST_PROXY" > deploy/image.env
printf 'Deployed %s\n' "$version"
