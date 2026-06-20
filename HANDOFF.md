# Handoff — pick up here

## Where we are: **v0.2.0 "First Bolt" 🔩** — Phase 1 complete (PR #2, played live)

A real build loop on the authoritative server: robots haul from depots to a ghost
blueprint and place pieces; the top row is **two-robot weld** pieces (holder +
welder, player *or* AI bot); **autonomous builder bots** keep the site bustling;
contracts **loop**; and dropped phones **reconnect and resume the same robot**
(§4.7). Phase 0 (`v0.1.0 First Light`) is on `main`; Phase 1 is on branch
`claude/dreamy-cray-20xncu` / **PR #2** (draft, awaiting review+merge).

- **Live:** `https://192-154-110-158.sslip.io` (password-gated) — on the LA box.
  Update it: SSH in, `git pull`, `sudo bash runserver.sh`, hard-refresh.
- **What it is / isn't:** README + design doc §9. Scope discipline: design doc §2.5.

## Run / operate

| | |
|---|---|
| Play locally | `bash play-local.sh` → http://localhost:5173 |
| Checks | `pnpm typecheck && pnpm test && pnpm build` |
| Egress/lag experiments | `LAG_MS=1000 pnpm dev:server`; `pnpm bot -- --count 200` |
| Update the live box | SSH in, `cd RobotMegaStructures`, `git pull && sudo bash runserver.sh` |

The live box is cloned on branch `claude/hopeful-shannon-9q9hfz` (now merged to
`main`) — `git pull` keeps working. Next session: branch fresh off `main`.

## Architecture in a nutshell

- `packages/shared` — wire protocol + codec + fixed-point. **Change here = rebuild
  all three.** Bump `PROTOCOL_VERSION` on any protocol change.
- `packages/server` — `SimLoop` (tick), `Chunk` (actor-shaped, the one mutation
  entry is `applyIntent`), `Snapshotter` (full/delta), `WsGateway`, `Metrics`.
  In-memory; `state/repository.ts` is the seam for Valkey/Postgres.
- `packages/client` — PixiJS; `EntityStore` + `interpolate` (smooths snapshots),
  `Camera`, `Input`, `Hud`.
- `packages/bot` — headless load/lag harness.

## What Phase 1 shipped (branch `claude/dreamy-cray-20xncu`, PR #2)

1. ✅ **Ghost blueprint** — an 18-piece block (6×3, "rising") + four spread depots.
2. ✅ **Resources** — robot grabs from a depot and visibly carries material.
3. ✅ **Assembly** — deliver → `ghost → placed`; HUD `pieces X/Y` + banner.
4. ✅ **Looping contract** — completion celebrates, then resets to fresh ghosts.
5. ✅ **Connection resilience (§4.7)** — session token; reconnect resumes the
   **same robot** (position + load intact); dropped owner's robot **parked** for a
   grace window (`GRACE_PERIOD_MS`); hardened client reconnect (connect-watchdog,
   zombie-socket detection, superseded-socket guards, tap-to-retry).
6. ✅ **Builder bots / living worksite** — `SEED_BUILDERS` NPCs run the build loop
   autonomously (slower + a dawdle). Seed of the commandable crew/swarm.
7. ✅ **Two-robot weld (§10)** — top-row `EntityKind.WeldPiece`s need a *holder*
   (carrying) + a *welder*; Ghost → Reserved → InProgress → Placed. Either role
   can be a **player or an AI bot** (bots pair up autonomously and assist players).
   A reservation **TTL** + per-tick participant checks mean a dropped/leaving
   partner never deadlocks (release to ghost, or demote to awaiting-partner).

How it works: one `C_INTENT_INTERACT` (server resolves pickup/deliver/weld by
context); pieces/resources/weld-pieces are `EntityKind`s on the same snapshot
path; robot `status` is a bitfield (`Moving|Carrying`); domain events ride
`S_EVENT`. **Protocol v4.** Delta snapshots ship status changes (static pieces
don't move). Robots carry `isNpc`/`isBuilder` vs controlled vs `parked`, plus
`engagedPieceId` while holding/welding. The weld state machine + builder AI live
in `Chunk` (`driveBuilder`, `advanceWelds`); piece weld state in `Piece`.

## Next up: **Phase 2** — the world gets big (design discussion w/ Ben, 2026-06-20)

Ben's steer for what's next (record so it isn't lost):
- **Side-scrolling landscape** extending far left/right that **wraps** (a circular
  planet you can walk all the way around — Terraria/Starbound/Mario feel), with the
  megastructure rising up and up. Lay the **aesthetic** down early.
- **Surface-resource search + digging/mining** as a real way to source materials
  from the planet (depots become a starting convenience, not the whole story).
- **Commandable AI crews / swarms** (builders are the seed) and a **delivery-swarm**
  robot type — set-and-forget far journeys that still need coordination.

Engine-wise this is where the **chunk grid + interest management** (design doc
§4.3) finally earns its keep — the world stops being one 1024² chunk. The
`ChunkRegistry` indirection + viewport AOI filter are already the seams for it.

## Gotchas we learned (don't re-discover these)

- **Caddy + WebSocket:** keep `/ws` in its own `handle{}` and out of `basic_auth`.
- **Fresh hosts** often already run nginx on :80 (installer now retires it).
- **TS 6 typed arrays:** encoded frames are typed `Uint8Array<ArrayBuffer>` so the
  browser `WebSocket.send` signature is satisfied (see `shared/codec.ts`).
- **Interpolation timing** uses an arrival-anchored playback clock (not an absolute
  clock offset) — robust to asymmetric injected lag (see `client/main.ts`).
- **Delta snapshots must ship non-positional changes too.** The position-only
  delta path silently drops a `status` flip on a static entity (e.g. a piece
  going ghost → placed). The Snapshotter restates an entity whose `status`
  changed in `added`; remember this when adding any future per-entity state.
