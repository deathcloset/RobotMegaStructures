#!/usr/bin/env bash
# Idempotent first-time provisioning for Ubuntu 24.04. Run as root, from the repo
# root, with your domain set:
#
#   sudo DOMAIN=play.example.com bash deploy/provision.sh
#
# Safe to re-run. Installs Node 22, Caddy, the service user, dirs, env file,
# Caddyfile, systemd unit, and a ufw baseline. Then run deploy/deploy.sh.
set -euo pipefail

DOMAIN="${DOMAIN:-example.com}"
NODE_MAJOR=22

if [ "$(id -u)" -ne 0 ]; then
  echo "must run as root (use sudo)" >&2
  exit 1
fi
if [ ! -f deploy/Caddyfile ]; then
  echo "run from the repo root (deploy/ not found)" >&2
  exit 1
fi

echo "==> apt prerequisites"
apt-get update -y
apt-get install -y curl ca-certificates gnupg ufw rsync

echo "==> Node.js ${NODE_MAJOR}.x (NodeSource)"
if ! command -v node >/dev/null 2>&1 || [ "$(node -p 'process.versions.node.split(".")[0]')" != "$NODE_MAJOR" ]; then
  curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash -
  apt-get install -y nodejs
fi
node -v

echo "==> corepack + pnpm"
corepack enable
corepack prepare pnpm@10.33.0 --activate

echo "==> Caddy (official apt repo)"
if ! command -v caddy >/dev/null 2>&1; then
  apt-get install -y debian-keyring debian-archive-keyring apt-transport-https
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
    | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
    > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -y
  apt-get install -y caddy
fi
caddy version

echo "==> service user 'rms'"
id -u rms >/dev/null 2>&1 || useradd --system --no-create-home --shell /usr/sbin/nologin rms

echo "==> directories"
install -d -o rms -g rms /opt/rms/server/dist
install -d -o caddy -g caddy /srv/rms/client
install -d /etc/rms

echo "==> env file"
if [ ! -f /etc/rms/server.env ]; then
  install -m 0640 -o rms -g rms deploy/server.env.example /etc/rms/server.env
  echo "   wrote /etc/rms/server.env (edit knobs as needed)"
fi

echo "==> Caddyfile (domain: ${DOMAIN})"
sed "s/example\.com/${DOMAIN}/g" deploy/Caddyfile > /etc/caddy/Caddyfile
systemctl reload caddy 2>/dev/null || systemctl restart caddy

echo "==> systemd unit"
install -m 0644 deploy/rms-server.service /etc/systemd/system/rms-server.service
systemctl daemon-reload
systemctl enable rms-server >/dev/null 2>&1 || true

echo "==> firewall (ufw): allow SSH/80/443"
ufw allow OpenSSH || true
ufw allow 80/tcp || true
ufw allow 443/tcp || true
yes | ufw enable || true
ufw status verbose || true

echo
echo "==> provisioning done. Next: bash deploy/deploy.sh"
