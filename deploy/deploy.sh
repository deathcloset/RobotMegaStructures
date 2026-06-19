#!/usr/bin/env bash
# Build and publish the server bundle + client static files, then restart the
# service. Run as root from the repo root on the box (after `git pull`):
#
#   sudo bash deploy/deploy.sh
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

if [ "$(id -u)" -ne 0 ]; then
  echo "must run as root (use sudo)" >&2
  exit 1
fi

echo "==> installing deps"
corepack enable
corepack prepare pnpm@10.33.0 --activate
pnpm install --frozen-lockfile

echo "==> building server bundle + client"
pnpm --filter @rms/server build
pnpm --filter @rms/client build

echo "==> publishing server (single self-contained dist/index.js — no node_modules needed)"
install -d -o rms -g rms /opt/rms/server/dist
install -m 0644 -o rms -g rms packages/server/dist/index.js /opt/rms/server/dist/index.js
if [ -f packages/server/dist/index.js.map ]; then
  install -m 0644 -o rms -g rms packages/server/dist/index.js.map /opt/rms/server/dist/index.js.map
fi

echo "==> publishing client static files"
rsync -a --delete packages/client/dist/ /srv/rms/client/
chown -R caddy:caddy /srv/rms/client

echo "==> restarting service"
systemctl restart rms-server
sleep 1
systemctl --no-pager --lines=0 status rms-server | head -n 6 || true

echo
echo "==> deployed. Tail logs:   journalctl -u rms-server -f"
echo "    Metrics via tunnel:    ssh -N -L 8080:127.0.0.1:8080 <user>@<box>  then curl localhost:8080/metrics.json"
