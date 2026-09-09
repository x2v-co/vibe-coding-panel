#!/usr/bin/env bash
set -euo pipefail
cd /opt/vibe-coding-panel
exec 9>deploy/deploy.lock
flock -w 120 9
image=$(cat deploy/previous-image)
[[ "$image" =~ ^sha256:[a-f0-9]{64}$ ]] || exit 1
docker image inspect "$image" >/dev/null
export PANEL_RELAY_IMAGE="$image"
export PANEL_RELAY_TRUST_PROXY=$(docker inspect vibe-coding-panel-caddy-1 --format '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}')
docker compose -f docker-compose.relay.yml -f deploy/image.yml up -d --no-build --no-deps relay
docker exec vibe-coding-panel-caddy-1 caddy reload --config /etc/caddy/Caddyfile
for attempt in $(seq 1 30); do
  if docker exec vibe-coding-panel-relay-1 wget -qO- http://127.0.0.1:8789/healthz; then
    printf 'PANEL_RELAY_IMAGE=%s\nPANEL_RELAY_TRUST_PROXY=%s\n' "$image" "$PANEL_RELAY_TRUST_PROXY" > deploy/image.env
    printf '%s\n' "$image" > deploy/current-image
    exit 0
  fi
  sleep 2
done
exit 1
