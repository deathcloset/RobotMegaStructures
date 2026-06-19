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

echo "==> Status:"
systemctl --no-pager --lines=0 status rms-server 2>/dev/null | head -n 4 || true
echo
echo "Done. Watch the game live with:  journalctl -u rms-server -f"
