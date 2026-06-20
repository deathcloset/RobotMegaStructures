# Robot Mega Structures

A browser game where lots of little robots build an enormous structure together,
joinable from a link on the cheapest phone. See the full vision in
[`Robot-Mega-Structures-Design-Doc-v1.1.md`](./Robot-Mega-Structures-Design-Doc-v1.1.md).

**Status: v0.2.0 "First Bolt" 🔩** (Phase 1 complete) — see [`CHANGELOG.md`](./CHANGELOG.md)
for what shipped and [`HANDOFF.md`](./HANDOFF.md) to pick up development.

**What works today (Phase 1):** a real build loop on a live authoritative server —
robots haul material from depots to a ghost blueprint and place it; a top row of
**two-robot weld** pieces needs a holder + a welder (a player *or* an AI bot);
**autonomous builder bots** keep the worksite bustling; finished contracts loop to
a fresh blueprint; and dropped phones **reconnect and resume the same robot**
(position + carried item intact). Click/tap to move, pan, zoom, and build. 🤖

---

## New here? 60-second glossary

You asked: *"is this a branch or a PR or a Pull?"* — here's the whole vocabulary:

- **Repository ("repo")** — the project folder, tracked by **git**. This is it.
- **Clone** — download a copy of the repo to a computer (command below).
- **Branch** — a parallel copy of the code you can change without touching the
  main version. The new code lives on a branch called `claude/hopeful-shannon-9q9hfz`.
- **`main`** — the primary branch (the "official" version).
- **Pull Request (PR, a.k.a. "pull")** — a request to merge a branch into `main`,
  with a page on GitHub to review the changes. Ours is **PR #1**. Merging it copies
  this code into `main`.

So: the code is on a **branch**, proposed via a **PR**. Nothing is in `main` yet
until you click **Merge** on PR #1.

> **About "venv":** that's a *Python* thing. This is a JavaScript/Node project, so
> there's no venv — but you get the same tidiness for free: `pnpm install` puts all
> the project's libraries in a local `node_modules` folder *inside this project*
> (nothing gets installed system-wide). On the server we go further and bundle the
> whole game server into one single file. So: no venv needed, nothing to pollute
> your machine.

---

## Play it on your own computer (5 minutes)

Great for trying it yourself before hosting.

1. **Install Node.js 22** — get the "LTS" build from <https://nodejs.org>
   (Windows/macOS: just run the installer).
2. **Get the code.** On GitHub click the green **Code** button → **Download ZIP**
   and unzip it — *or*, if you have git:
   ```bash
   # while the code is still on the branch (before PR #1 is merged):
   git clone -b claude/hopeful-shannon-9q9hfz https://github.com/deathcloset/RobotMegaStructures.git
   # (after you merge PR #1, drop the -b part and just clone normally)
   cd RobotMegaStructures
   ```
3. **Run it:**
   - macOS / Linux: `bash play-local.sh`
   - Any OS (manual): `corepack enable` then `pnpm install` then `pnpm dev`
4. Open **<http://localhost:5173>** in your browser. Click to move your robot;
   open a second tab to watch the same robots move in both.

---

## Host it for your testers

This puts the game on the internet behind a password so anyone you share the link
with can play from their phone or PC. Designed for your Ubuntu server (e.g. the
Gorilla box in LA). You don't need Apache or nginx — the installer sets up
**Caddy**, which serves the game and handles HTTPS automatically.

**You need:** the server's IP address and SSH access to it.

1. **Connect to your server** (from your home PC):
   ```bash
   ssh youruser@YOUR.SERVER.IP
   ```
2. **Get the code onto the server:**
   ```bash
   sudo apt update && sudo apt install -y git
   git clone -b claude/hopeful-shannon-9q9hfz https://github.com/deathcloset/RobotMegaStructures.git
   cd RobotMegaStructures
   ```
3. **Run the installer:**
   ```bash
   sudo bash install.sh
   ```
   It asks two things:
   - **How testers reach it** — press **1** for a free auto-HTTPS address based on
     your IP (no domain needed), or **2** if you own a domain pointed at the box.
   - **A password** for testers.

   Then it installs everything, opens the firewall, and starts the game.

4. When it finishes it prints your **URL + username (`tester`) + password**. Share
   those. First visit takes ~30s while the HTTPS certificate is issued, then it's
   instant. Visit the URL → type the password → you're in and moving robots.

**Updating later** (after new code lands):
```bash
git pull
sudo bash runserver.sh
```

### Firewall / ports

`install.sh` opens these for you with Ubuntu's firewall (`ufw`). For reference, or
to do it by hand:
```bash
sudo ufw allow OpenSSH    # port 22 — KEEP this or you'll lock yourself out!
sudo ufw allow 80/tcp     # http — needed to issue the HTTPS certificate
sudo ufw allow 443/tcp    # https — the game itself
sudo ufw enable
sudo ufw status
```
The game server's own port **8080 stays closed** on purpose: it only listens on
the machine itself, and Caddy talks to it internally. Nothing else needs opening.

### Change or remove the password later

Edit `/etc/caddy/Caddyfile` (the `basic_auth` block), then `sudo systemctl reload
caddy`. Re-running `sudo bash install.sh` also lets you set a new one.

---

## For developers

A pnpm + TypeScript monorepo. The binding constraint for this game is **egress,
not CPU** (design doc §7.2), so **bytes/player/tick** is the north-star metric,
instrumented from the first commit.

```
packages/
  shared/   wire protocol + MessagePack codec + fixed-point math (used by all 3)
  server/   authoritative sim: tick loop, chunk, snapshotter, WS gateway, metrics
  client/   PixiJS v8: pan/zoom camera, interpolation, input->intents, HUD
  bot/      headless load + lag test harness
deploy/     templates for the hosting scripts
```

| Command | Does |
|---|---|
| `pnpm dev` | server (:8080) + client (:5173) with hot reload |
| `pnpm typecheck` | `tsc --noEmit` across all packages |
| `pnpm test` | Vitest (codec, fixed-point, movement, interpolation) |
| `pnpm build` | bundle server + bot to single files; Vite-build the client |
| `pnpm lint` / `pnpm lint:fix` | Biome |
| `pnpm bot -- <args>` | load/lag harness |

### The two Phase 0 experiments

**Smooth movement under ~1 s lag** — the server can inject artificial latency; the
client renders behind the newest snapshot by an interpolation delay so motion stays
smooth at 2–5 Hz:
```bash
LAG_MS=1000 JITTER_MS=100 pnpm dev:server     # then drag a robot in the client
```
You can also inject lag purely client-side: `http://localhost:5173/?lag=1000&jitter=100`.

**Egress + the full-vs-delta lever** — `SNAPSHOT_MODE` switches full snapshots vs
position deltas (the biggest egress lever, §7.2). A/B it under bot load:
```bash
SNAPSHOT_MODE=delta pnpm dev:server
pnpm bot -- --url ws://localhost:8080/ws --count 200 --rate 2 --duration 30
```
Watch `bytes_per_player_per_tick` in the server's log line / `GET /metrics.json`,
cross-checked by the bot reporter. Phase 0 has one chunk, so this measures honest
worst-case fan-out; interest management's win shows up across many chunks in Phase 2.

### Bot harness flags

`--url` (`ws://localhost:8080/ws`) · `--count` (50) · `--rate` Hz (2) ·
`--duration` s, 0=forever (0) · `--spawn` conns/sec ramp (50).

### Server env knobs

`HOST`, `PORT`, `TICK_HZ` (10), `BROADCAST_HZ` (4), `SNAPSHOT_MODE`
(`full`|`delta`), `KEYFRAME_INTERVAL_MS` (5000), `LAG_MS`/`JITTER_MS` (0),
`SEED_ROBOTS` (8), `METRICS_LOG_MS` (5000). See [`.env.example`](./.env.example).

### Deliberately deferred (doors left open, per design doc §2.5/§4.6)

Valkey + Postgres (only the `WorldRepo` seam exists; Valkey is the chosen cache for
Phase 2), grace-period reconnect & reservation TTLs (§4.7), client-side prediction,
and all gameplay: piece state machine, two-robot assembly, multi-chunk + OSHA
handoff, spectators, certs/crews, aliens, WebTransport, accounts. The entity-neutral
model, `ChunkRegistry` indirection, viewport AOI filter, and domain-event stream are
the cheap hooks placed now so those land without a rewrite.

## License

AGPL-3.0 — see [`LICENSE`](./LICENSE).
