#!/usr/bin/env bash
# scripts/bootstrap.sh — run ONCE on a fresh Hetzner Ubuntu box.
#
#   usage:  ./scripts/bootstrap.sh                       # defaults to root@116.203.39.245
#           ./scripts/bootstrap.sh root@1.2.3.4          # different host
#           DOMAIN=api.example.com ./scripts/bootstrap.sh  # override domain
#
# Idempotent: re-runs cleanly. Installs Bun, Caddy (auto-HTTPS), UFW, a non-root
# 'stratus' user, and a systemd unit. Does NOT deploy app code — that's deploy.sh.

set -euo pipefail

REMOTE="${1:-root@116.203.39.245}"
DOMAIN="${DOMAIN:-stratus-narcis.duckdns.org}"

echo "==> bootstrapping $REMOTE for domain $DOMAIN"

ssh "$REMOTE" DOMAIN="$DOMAIN" bash -s <<'REMOTE_SCRIPT'
set -euo pipefail

echo "==> apt update + base packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y curl unzip git ufw ca-certificates debian-keyring debian-archive-keyring apt-transport-https gnupg

echo "==> firewall (ufw)"
ufw --force reset
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable

echo "==> create 'stratus' user"
id -u stratus >/dev/null 2>&1 || useradd -m -s /bin/bash stratus
install -d -o stratus -g stratus -m 0750 /home/stratus/app
install -d -o stratus -g stratus -m 0700 /home/stratus/.config

echo "==> install Bun as 'stratus'"
sudo -u stratus -H bash -lc '
  if ! command -v bun >/dev/null; then
    curl -fsSL https://bun.sh/install | bash
  fi
  grep -q ".bun/bin" ~/.profile 2>/dev/null || echo "export PATH=\"\$HOME/.bun/bin:\$PATH\"" >> ~/.profile
'
ln -sf /home/stratus/.bun/bin/bun /usr/local/bin/bun

echo "==> install Caddy (official repo)"
if ! command -v caddy >/dev/null; then
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
    | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
    > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -y
  apt-get install -y caddy
fi

echo "==> write Caddyfile for $DOMAIN"
cat >/etc/caddy/Caddyfile <<EOF
${DOMAIN} {
  encode zstd gzip
  reverse_proxy 127.0.0.1:3000
}
EOF
systemctl reload caddy

echo "==> systemd unit for stratus"
cat >/etc/systemd/system/stratus.service <<'UNIT'
[Unit]
Description=stratus API (Bun + Hono)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=stratus
Group=stratus
WorkingDirectory=/home/stratus/app
EnvironmentFile=/home/stratus/app/.env
ExecStart=/usr/local/bin/bun run src/app.ts
Restart=on-failure
RestartSec=3
LimitNOFILE=65535
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=false
ReadWritePaths=/home/stratus/app
PrivateTmp=true

[Install]
WantedBy=multi-user.target
UNIT

systemctl daemon-reload
systemctl enable stratus.service

echo "==> bootstrap done."
echo "    domain: $DOMAIN"
echo "    next:   ./scripts/deploy.sh"
REMOTE_SCRIPT
