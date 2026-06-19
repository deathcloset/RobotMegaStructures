# Robot Mega Structures

A browser-based, massively-multiplayer cooperative construction game. Tiny robots
build an enormous structure together on a barren planet, joinable from a URL on
the cheapest phone. See [`Robot-Mega-Structures-Design-Doc-v1.1.md`](./Robot-Mega-Structures-Design-Doc-v1.1.md)
for the full vision and architecture.

This repo currently implements **Phase 0 — "Skeleton / prove the pipe"** (§9 of
the doc): one authoritative sim server, a PixiJS client that interpolates
authoritative state, a headless bot load-harness, egress instrumentation, and
artificial latency injection — everything needed to answer *"does many people
moving around one thing over a laggy connection feel good, and what does it cost
in bandwidth?"*

> The binding constraint for this game is **egress, not CPU** (doc §7.2). So the
> north-star metric is **bytes/player/tick**, instrumented from the first commit
> and exposed live on both server and client.

## Layout

```
packages/
  shared/   wire protocol + MessagePack codec + fixed-point math (used by all 3)
  server/   authoritative sim: tick loop, chunk, snapshotter, WS gateway, metrics
  client/   PixiJS v8: pan/zoom camera, interpolation, input→intents, HUD
  bot/      headless load + lag test harness (the doc's Phase 0 mandate)
deploy/     single-box Ubuntu 24.04: Caddy (auto-TLS), systemd, provision/deploy
scripts/    esbuild bundler (server/bot → one self-contained file)
```

The chunk is written as an **isolated, actor-shaped unit** (message-in/state-out,
no I/O inside) so a later Elixir/Phoenix port — and Phase 1+ entity kinds — are
mechanical, not a rewrite (doc §4.4/§4.6). Valkey and Postgres are **deliberately
absent**: Phase 0 is in-memory; a `WorldRepo` interface marks where they slot in
at Phase 2/3.

## Prerequisites

- **Node 22** (`.nvmrc`) · **pnpm 10** (`corepack enable`)

## Quickstart

```bash
corepack enable
pnpm install
pnpm dev            # server on :8080, client on http://localhost:5173
```

Open `http://localhost:5173` in two tabs: click to move your robot; it moves in
both tabs (server-authoritative). NPC robots wander so the site is never empty.

### Useful scripts

| Command | Does |
|---|---|
| `pnpm dev` | server + client with hot reload |
| `pnpm dev:server` / `pnpm dev:client` | run one side |
| `pnpm typecheck` | `tsc --noEmit` across all packages |
| `pnpm test` | Vitest (codec round-trip, fixed-point, movement, interpolation) |
| `pnpm build` | bundle server + bot to single files; Vite-build the client |
| `pnpm lint` / `pnpm lint:fix` | Biome |
| `pnpm bot -- <args>` | run the load/lag harness (see below) |

## The two Phase 0 experiments

### 1. Smooth movement under ~1 s lag (prove the feel)

The server can inject artificial outbound latency; the client renders behind the
newest snapshot by an interpolation delay (`?interp=`, default 300 ms) anchored to
server-stamped time, so motion stays smooth despite 2–5 Hz updates.

```bash
# server with 1s ± 100ms outbound lag, 4 Hz broadcast
LAG_MS=1000 JITTER_MS=100 BROADCAST_HZ=4 pnpm dev:server
```
Then open the client and drag a robot: it should glide, just delayed by ~1 s — no
teleporting or stutter. Sweep `BROADCAST_HZ` (2→5) and `?interp=` (200→500) to
find the lowest broadcast rate that still feels smooth (that directly lowers
egress). You can also inject lag purely client-side against a clean server:
`http://localhost:5173/?lag=1000&jitter=100`.

### 2. Egress + the full-vs-delta lever (prove the cost)

`SNAPSHOT_MODE` switches between full snapshots and position deltas — the single
biggest egress lever (doc §7.2). A/B it under identical bot load:

```bash
# terminal 1
SNAPSHOT_MODE=full  pnpm dev:server
# terminal 2
pnpm bot -- --url ws://localhost:8080/ws --count 200 --rate 2 --duration 30
```
Watch **bytes/player/tick** in the server's 5 s log line (and `/metrics.json`),
cross-checked by the bot reporter's per-client KB/s. Re-run with
`SNAPSHOT_MODE=delta` and compare. Multiply your measured bytes/player/tick by
target population to compare against the doc's ~1.6 Gbps wall at 10k players.

> Phase 0 has **one chunk**, so every robot is in view — this measures honest
> worst-case fan-out. Interest management's win shows up across *many* chunks in
> Phase 2.

## Bot harness

```bash
pnpm bot -- --url ws://localhost:8080/ws --count 200 --rate 2 --duration 30
```
| Flag | Default | Meaning |
|---|---|---|
| `--url` | `ws://localhost:8080/ws` | server endpoint (use `wss://…/ws` for a deployed box) |
| `--count` | `50` | number of simulated clients |
| `--rate` | `2` | move-intent rate per bot (Hz) |
| `--duration` | `0` | seconds before auto-shutdown (`0` = run until Ctrl-C) |
| `--spawn` | `50` | connection ramp per second (avoids thundering-herd) |

## Metrics

The server exposes (same port as WS, kept off the public net in deploy):

- `GET /metrics.json` — JSON incl. `bytes_per_player_per_tick`, `egress_kbps`, `tick_ms_p95`, `broadcast_ms_p95`, `connections`
- `GET /metrics` — Prometheus text
- a one-line `pino`-style summary every `METRICS_LOG_MS`

## Configuration (server env)

`HOST`, `PORT`, `TICK_HZ` (10), `BROADCAST_HZ` (4), `SNAPSHOT_MODE` (`full`|`delta`),
`KEYFRAME_INTERVAL_MS` (5000), `LAG_MS`/`JITTER_MS` (0), `SEED_ROBOTS` (8),
`METRICS_LOG_MS` (5000). See [`.env.example`](./.env.example).

## Deploy

Single box, Ubuntu 24.04, Caddy auto-TLS + WebSocket passthrough, systemd, `ufw`.
The server ships as one self-contained bundled file (no `node_modules` in prod).
See [`deploy/README.md`](./deploy/README.md):

```bash
sudo DOMAIN=play.example.com bash deploy/provision.sh
sudo bash deploy/deploy.sh
```

## Deliberately deferred (doors left open, per §2.5/§4.6)

Valkey + Postgres (only the `WorldRepo` seam exists), grace-period reconnect &
reservation TTLs (§4.7 — robot removal is isolated in one method), client-side
prediction (Phase 0 answers "is interpolation alone enough?"), and all gameplay:
piece state machine, two-robot assembly, multi-chunk + OSHA handoff, spectators,
certs/crews, aliens, WebTransport, auth. The entity-neutral model, the
`ChunkRegistry` indirection, the viewport-driven AOI filter, and the domain-event
stream are the cheap hooks placed now so those land without a rewrite.

## License

AGPL-3.0 — see [`LICENSE`](./LICENSE).
