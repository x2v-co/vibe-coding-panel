#!/bin/sh
set -eu
# Certbot deploy hook. Only install the Vibe certificate; never replace Toolkit's
# existing Origin CA certificate. Install this script root-owned, mode 0755.
lineage=${RENEWED_LINEAGE:-/etc/letsencrypt/live/vibe-panel-cn}
[ "$lineage" = /etc/letsencrypt/live/vibe-panel-cn ] || exit 0
cert_root=/opt/x2v/toolkit_new/production-cn/nginx/certs
serial=$(openssl x509 -in "$lineage/fullchain.pem" -noout -serial | cut -d= -f2)
case "$serial" in ''|*[!A-Fa-f0-9]*) exit 1 ;; esac
release="vibe-releases/$serial"
install -d -m 0755 "$cert_root/$release"
install -m 0644 "$lineage/fullchain.pem" "$cert_root/$release/fullchain.pem"
install -m 0600 "$lineage/privkey.pem" "$cert_root/$release/privkey.pem"
previous=$(readlink "$cert_root/vibe" || true)
ln -sfn "$release" "$cert_root/.vibe-next"
mv -Tf "$cert_root/.vibe-next" "$cert_root/vibe"
if ! docker exec toolkit_cn-nginx-1 nginx -t; then
    if [ -n "$previous" ]; then
        ln -sfn "$previous" "$cert_root/.vibe-next"
        mv -Tf "$cert_root/.vibe-next" "$cert_root/vibe"
    else
        rm "$cert_root/vibe"
    fi
    exit 1
fi
docker exec toolkit_cn-nginx-1 nginx -s reload
