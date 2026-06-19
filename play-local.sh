#!/usr/bin/env bash
#
# Play Robot Mega Structures on your own computer (macOS or Linux).
# Needs Node.js 22+ installed first (https://nodejs.org — pick the "LTS" build).
#
#     bash play-local.sh
#
# Then open http://localhost:5173 in your browser. Ctrl+C to stop.
#
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is not installed. Get the LTS build from https://nodejs.org and run this again." >&2
  exit 1
fi

corepack enable 2>/dev/null || true

echo "Installing (the first time can take a minute or two)…"
pnpm install

echo
echo "Starting! Open  http://localhost:5173  in your browser."
echo "Open it in two tabs to watch one robot move in both. Ctrl+C to stop."
echo
pnpm dev
