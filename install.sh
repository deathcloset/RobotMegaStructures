#!/usr/bin/env bash
#
# Robot Mega Structures — one-shot installer for an Ubuntu 22.04 / 24.04 server.
#
# It installs everything, asks you for a password, opens the firewall, and starts
# hosting the game over HTTPS so your testers can connect from any browser.
#
# Run it as root, from inside the project folder:
#
#     sudo bash install.sh
#
# You only run this ONCE. To update later: `git pull && sudo bash runserver.sh`.
#
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
  echo "Please run with sudo:  sudo bash install.sh" >&2
  exit 1
fi
cd "$(dirname "${BASH_SOURCE[0]}")"
if [ ! -f deploy/Caddyfile.template ]; then
  echo "Run this from the project folder (the one containing install.sh)." >&2
  exit 1
fi

NODE_MAJOR=22
AUTH_USER="${RMS_USER:-tester}"

echo
echo "============================================================"
echo "  Robot Mega Structures — installer"
echo "============================================================"
echo

# ---------- where will testers reach it? ----------
PUBLIC_IP="$(curl -fsS --max-time 10 https://api.ipify.org || true)"
DOMAIN="${DOMAIN:-}"
if [ -z "$DOMAIN" ]; then
  echo "This server's public IP looks like: ${PUBLIC_IP:-<could not detect>}"
  echo
  echo "How should testers reach the game?"
  echo "  1) Free auto-HTTPS web address based on this IP  (no domain needed) <- easiest"
  echo "  2) I have my own domain name pointed at this server"
  echo
  read -rp "Choose 1 or 2 [1]: " choice
  choice="${choice:-1}"
  if [ "$choice" = "2" ]; then
    read -rp "Enter your domain (e.g. play.example.com): " DOMAIN
  fi
fi

if [ -z "$DOMAIN" ]; then
  if [ -z "$PUBLIC_IP" ]; then
    echo "Could not detect this server's public IP. Re-run with: sudo DOMAIN=your.domain bash install.sh" >&2
    exit 1
  fi
  # sslip.io turns an IP into a hostname so we can get a real HTTPS certificate.
  SITE="$(echo "$PUBLIC_IP" | tr '.' '-').sslip.io"
else
  SITE="$DOMAIN"
fi
echo
echo "  -> Your game will be at:  https://${SITE}"
echo

# ---------- the tester password ----------
PW="${RMS_PASSWORD:-}"
if [ -z "$PW" ]; then
  read -rsp "Set a password your testers will type to get in: " PW; echo
  [ -z "$PW" ] && { echo "Password cannot be empty." >&2; exit 1; }
fi

echo
echo "==> Installing system packages (Node.js, Caddy web server, tools)…"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y curl ca-certificates gnupg ufw rsync

if ! command -v node >/dev/null 2>&1 || [ "$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)" != "$NODE_MAJOR" ]; then
  curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash -
  apt-get install -y nodejs
fi
corepack enable
corepack prepare pnpm@10.33.0 --activate

if ! command -v caddy >/dev/null 2>&1; then
  apt-get install -y debian-keyring debian-archive-keyring apt-transport-https
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
    | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
    > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -y
  apt-get install -y caddy
fi

echo "==> Creating service user + folders…"
id -u rms >/dev/null 2>&1 || useradd --system --no-create-home --shell /usr/sbin/nologin rms
install -d -o rms -g rms /opt/rms/server/dist
install -d -o caddy -g caddy /srv/rms/client
install -d /etc/rms
[ -f /etc/rms/server.env ] || install -m 0640 -o rms -g rms deploy/server.env.example /etc/rms/server.env

echo "==> Configuring HTTPS + password…"
AUTH_HASH="$(caddy hash-password --plaintext "$PW")"
sed -e "s|__SITE__|${SITE}|" \
    -e "s|__AUTHUSER__|${AUTH_USER}|" \
    -e "s|__AUTHHASH__|${AUTH_HASH}|" \
    deploy/Caddyfile.template > /etc/caddy/Caddyfile
install -m 0644 deploy/rms-server.service /etc/systemd/system/rms-server.service
systemctl daemon-reload
systemctl enable rms-server >/dev/null 2>&1 || true

echo "==> Opening the firewall (SSH, HTTP, HTTPS)…"
ufw allow OpenSSH 2>/dev/null || ufw allow 22/tcp || true
ufw allow 80/tcp || true
ufw allow 443/tcp || true
yes | ufw enable || true

echo "==> Building and starting the game…"
bash runserver.sh

echo
echo "============================================================"
echo "  Robot Mega Structures is LIVE"
echo
echo "    URL:      https://${SITE}"
echo "    Username: ${AUTH_USER}"
echo "    Password: (the one you just set)"
echo
echo "  Share that URL + password with your testers."
echo "  The very first visit can take ~30s while the HTTPS"
echo "  certificate is issued — then it's instant."
echo
echo "  Watch it live:   journalctl -u rms-server -f"
echo "============================================================"
