# Deploy internals

The friendly path is the root [`install.sh`](../install.sh) and
[`runserver.sh`](../runserver.sh) — see the main [README](../README.md#host-it-for-your-testers).
This folder holds the templates those scripts use.

| File | Used for |
|---|---|
| `Caddyfile.template` | `install.sh` substitutes the site address + password hash and writes `/etc/caddy/Caddyfile` |
| `rms-server.service` | the systemd unit (`/etc/systemd/system/rms-server.service`) that supervises the sim server |
| `server.env.example` | copied to `/etc/rms/server.env` (tick/broadcast/snapshot/lag knobs) on first install |

## What ends up where

| Thing | Location | Role |
|---|---|---|
| Node 22 (NodeSource) | `/usr/bin/node` | runs the bundled server |
| Caddy (apt) | `/etc/caddy/Caddyfile` | HTTPS, password gate, serves client, WebSocket passthrough |
| `rms` system user | — | runs the server (never root) |
| Server bundle | `/opt/rms/server/dist/index.js` | one self-contained file, no `node_modules` |
| Client static | `/srv/rms/client/` | Vite build output, served by Caddy |
| Env file | `/etc/rms/server.env` | runtime knobs |

## Ports

`install.sh` opens **22 (SSH), 80 (HTTP, for the cert), 443 (HTTPS)** via `ufw`.
The sim server's port **8080 is intentionally NOT opened** — it binds to
`127.0.0.1` and is reached only through Caddy.

## Operating

```bash
journalctl -u rms-server -f                 # live logs incl. the 5s egress summary
sudo systemctl restart rms-server           # after editing /etc/rms/server.env
ssh -N -L 8080:127.0.0.1:8080 user@box      # tunnel, then: curl localhost:8080/metrics.json
```

Metrics are deliberately not exposed publicly; reach them over the SSH tunnel above.
