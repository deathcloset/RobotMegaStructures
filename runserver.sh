#!/usr/bin/env bash
#
# (Re)build and (re)start the hosted Robot Mega Structures server.
#
# Run as root from the project folder — after install.sh, or any time you pull
# new code and want it live:
#
#     git pull
#     sudo bash runserver.sh
#
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
  echo "Please run with sudo:  sudo bash runserver.sh" >&2
  exit 1
fi
cd "$(dirname "${BASH_SOURCE[0]}")"

echo "==> Installing dependencies…"
corepack enable
corepack prepare pnpm@10.33.0 --activate
pnpm install --frozen-lockfile

echo "==> Building server + client…"
pnpm --filter @rms/server build
pnpm --filter @rms/client build

echo "==> Publishing files…"
install -d -o rms -g rms /opt/rms/server/dist
install -m 0644 -o rms -g rms packages/server/dist/index.js /opt/rms/server/dist/index.js
if [ -f packages/server/dist/index.js.map ]; then
  install -m 0644 -o rms -g rms packages/server/dist/index.js.map /opt/rms/server/dist/index.js.map
fi
rsync -a --delete packages/client/dist/ /srv/rms/client/
chown -R caddy:caddy /srv/rms/client

echo "==> Restarting services…"
systemctl restart rms-server
systemctl reload caddy 2>/dev/null || systemctl restart caddy || true

# Fail loudly if either service didn't come up — don't pretend success.
ok=1
if ! systemctl is-active --quiet rms-server; then
  echo "ERROR: rms-server is not running. Recent logs:" >&2
  journalctl -u rms-server -n 30 --no-pager >&2 || true
  ok=0
fi
if ! systemctl is-active --quiet caddy; then
  echo "ERROR: caddy is not running — the website will refuse connections. Recent logs:" >&2
  journalctl -u caddy -n 30 --no-pager >&2 || true
  ok=0
fi
[ "$ok" -eq 1 ] || { echo "One or more services failed to start (see above)." >&2; exit 1; }

echo "==> Both services are up."
systemctl --no-pager --lines=0 status rms-server 2>/dev/null | head -n 4 || true
echo
echo "Done. Watch the game live with:  journalctl -u rms-server -f"
