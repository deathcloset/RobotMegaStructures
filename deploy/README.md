# Deploy — single box, Ubuntu 24.04

Phase 0 runs on one machine: the AMD Ryzen 3900X / 128 GB / NVMe / **unmetered**
gigabit box. It's a single point of failure — fine for a PoC. Per the design doc
(§7.3) CPU/RAM are not the limit here; the 1 Gbps pipe is, and only in the high
thousands.

## What gets installed

| Piece | Where | Role |
|---|---|---|
| Node 22 (NodeSource) | `/usr/bin/node` | runs the bundled server |
| Caddy (apt) | `/etc/caddy/Caddyfile` | auto-TLS + serves the client + WebSocket passthrough |
| `rms` system user | — | runs the server (never root) |
| Server bundle | `/opt/rms/server/dist/index.js` | one self-contained file, no `node_modules` |
| Client static | `/srv/rms/client/` | Vite build output, served by Caddy |
| Env file | `/etc/rms/server.env` | tick/broadcast/snapshot/lag knobs |
| systemd unit | `/etc/systemd/system/rms-server.service` | supervises the server |

## First-time setup

Point a DNS A/AAAA record at the box, then, from the repo root on the box:

```bash
sudo DOMAIN=play.example.com bash deploy/provision.sh   # idempotent
sudo bash deploy/deploy.sh
```

`provision.sh` bakes your `DOMAIN` into `/etc/caddy/Caddyfile`; Caddy fetches a
Let's Encrypt cert automatically (ports 80/443 must be open — the script opens
them via `ufw`). The Node port (8080) is **not** opened; it's bound to localhost
and reached only through Caddy.

## Each subsequent deploy

```bash
git pull
sudo bash deploy/deploy.sh    # rebuilds, republishes, restarts
```

## Operating

```bash
journalctl -u rms-server -f                       # logs incl. the 5s egress summary
sudo systemctl restart rms-server                 # after editing /etc/rms/server.env
ssh -N -L 8080:127.0.0.1:8080 user@box            # tunnel, then:
curl localhost:8080/metrics.json                  # live metrics (kept off the public net)
```

## Tuning knobs (`/etc/rms/server.env`)

`TICK_HZ`, `BROADCAST_HZ`, `SNAPSHOT_MODE` (`full`|`delta`), `KEYFRAME_INTERVAL_MS`,
`LAG_MS`/`JITTER_MS` (artificial lag for feel tests), `SEED_ROBOTS`. Restart after
changes.

## Verify on the box

```bash
# from your laptop, point the load harness at the real server over TLS:
pnpm bot -- --url wss://play.example.com/ws --count 100 --rate 2 --duration 60
```
Watch `journalctl` for `bytes_per_player_per_tick` and `egress_kbps`, and open
`https://play.example.com` in a browser to confirm TLS + WebSocket + a moving
robot.
