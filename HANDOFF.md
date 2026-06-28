# Handoff — pick up here

## Where we are: **v0.2.0 "First Bolt" 🔩** — Phase 1 complete & merged to `main`

A real build loop on the authoritative server: robots haul from depots to a ghost
blueprint and place pieces; the top row is **two-robot weld** pieces (holder +
welder, player *or* AI bot); **autonomous builder bots** keep the site bustling;
contracts **loop**; and dropped phones **reconnect and resume the same robot**
(§4.7). Phase 0 (`v0.1.0`) and Phase 1 (`v0.2.0`) are both on **`main`**. Proven
live with 3 players (two phones + a PC). Longer-horizon ideas live in
[`IDEAS.md`](./IDEAS.md) (fuel, not roadmap — §2.5).

- **Live:** `https://192-154-110-158.sslip.io` (password-gated) — on the LA box.
- **What it is / isn't:** README + design doc §9. Scope discipline: design doc §2.5.
- **In flight (branch `claude/dreamy-newton-1rj5p1`, PR — not yet on `main`):**
  Phase 2 so far — **slice 1**: a wide **side-scrolling planet whose X axis wraps**;
  **slice 2**: **surface mining** (ore veins); **slice 3**: **commandable crews**
  (long-press a **work-flag**); **slice 4**: the **section grid + interest management**
  (ring of sections, per-viewport subscription — **8.5×** egress cut — + cross-section
  handoff); **slice 5**: **OSHA caps + the checkpoint** — each section has a robot cap
  and you queue at the checkpoint when it's full. Protocol **v8**. See CHANGELOG
  "Unreleased". Remaining Phase 2 (delivery-swarm type, then multi-server) is below.

## Run / operate

| | |
|---|---|
| Play locally | `bash play-local.sh` → http://localhost:5173 |
| Checks | `pnpm typecheck && pnpm test && pnpm build` |
| Egress/lag experiments | `LAG_MS=1000 pnpm dev:server`; `pnpm bot -- --count 200` |
| Update the live box | SSH in, `cd RobotMegaStructures`, `git checkout main && git pull && sudo bash runserver.sh`, hard-refresh |

The live box has been deployed from feature branches via `git checkout <branch>`;
now that Phase 1 is on `main`, switch it back to `main` (`git checkout main`) so
`git pull` tracks the mainline. **Phase 2: branch fresh off `main`.**

## Architecture in a nutshell

- `packages/shared` — wire protocol + codec + fixed-point + **cylinder wrap math
  (`world.ts`)**. **Change here = rebuild all three.** Bump `PROTOCOL_VERSION` on
  any protocol change.
- `packages/server` — `SimLoop` (tick), `ChunkRegistry` (the **section grid** + the
  routing/interest/handoff indirection), `Chunk` (actor-shaped, one section, the one
  mutation entry is `applyIntent`), `Snapshotter` (full/delta), `WsGateway`,
  `Metrics`. In-memory; `state/repository.ts` is the seam for Valkey/Postgres.
- `packages/client` — PixiJS; `EntityStore` + `interpolate` (smooths snapshots),
  `Camera`, `Input`, `Hud`.
- `packages/bot` — headless load/lag harness.

## What Phase 1 shipped (v0.2.0, on `main`)

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

## Next up: **Phase 2** — the world gets big (Ben's steer, 2026-06-20)

The fun is proven; now grow the world. Ben's direction (don't lose it):
- ✅ **Side-scrolling landscape that wraps** (slice 1, this branch) — a circular
  planet you can walk all the way around, the megastructure rising from the
  surface. Aesthetic laid down early (sky/atmosphere/ground/parallax).
- ✅ **Surface-resource search + digging/mining** (slice 2, this branch) — renewable
  ore veins scattered around the planet; an empty-handed robot digs one for a load
  that feeds the build loop. Depots are now the convenient starter, veins the wider
  story, and a share of builders (`SEED_MINERS`) are **prospectors** that mine on
  their own. (Eventually: below-surface digging.)
- ✅ **Commandable AI crews** (slice 3, this branch) — long-press plants a
  **work-flag** (`EntityKind.Flag`, one per player) and the builder crew rallies to
  mine the flagged area; tap your own flag to pick it up. Still wanted: a dedicated
  **delivery-swarm** robot type for set-and-forget far ferrying.
- ✅ **Chunk grid + OSHA handoff** (slices 4–5, this branch) — the planet is a ring of
  sections; interest is per-viewport (8.5× egress cut measured); robots hand off across
  boundaries; each section has an OSHA **cap** with queue-when-full at the checkpoint
  (§4.4). **Next:** real multi-server distribution (IDEAS.md "Distributed hosting" —
  Ben's vision: sections across small boxes; the `settle` handoff + cap are the seam).
- See [`IDEAS.md`](./IDEAS.md) for the longer arc (distributed hosting,
  living/maintenance hosting of finished structures, the megastructures game-set).

**What slice 1 settled (build on it, don't redo it):**
- **The wrap math is decided once** in `shared/world.ts` (`wrapX`, `wrapDeltaX`,
  `wrappedDistance`), server-authoritative and mirrored by the camera/renderer.
  Anything spatial that subtracts two X values must go through `wrapDeltaX`.
- **AOI is wrap-ready.** `broadcast/interest.ts` measures X the short way around
  the cylinder, so multi-chunk is still just "iterate chunks overlapping the
  viewport," and **egress per client stays flat as the world grows** (keep watching
  `bytes_per_player_per_tick`). The world geometry rides `S_WELCOME` (v5).

**What slices 4–5 built (the grid + checkpoint are real).** The world is a ring of
`CHUNK_COLS` sections; `ChunkRegistry` is the grid + the routing/interest/handoff
indirection (`chunkAt`, `chunksInView`, `settle`, `spawnSection`). `SimLoop` snapshots
each section once and each client gathers only the sections overlapping its viewport.
Each `Chunk` owns a world-X slice (`x0..x1`, `centerX`) + a `capacity`/`isFull`, but
still simulates in world coords with the global wrap, so it stays an isolated
message-in/state-out unit (the Elixir/multi-box port hedge, §5.4). `settle(now)`
enforces the OSHA cap (holds robots at full checkpoints, counts admissions so a burst
can't overfill) and returns the per-player nudges the gateway delivers as
`SectionFull`. Mining (slice 2) is the worked example for adding new `EntityKind`s
through the one `applyIntent` chokepoint — copy that shape.

**Next: distribution (and rough edges to polish).**
- **Multi-server:** the same `settle` handoff becomes a *network* handoff; `ChunkRegistry`
  becomes the seam where a section is owned by another process/box, coordinated over
  Redis/Valkey. See IDEAS.md "Distributed hosting" (Ben's capacity/failover vision).
  Don't build it until there's a second box to host (no consumer yet, §2.5).
- **Checkpoint polish (small):** NPCs stay in their section, so the cap is only felt by
  players today — let some builders/swarms cross to exercise it organically; a held
  player auto-resumes once a slot frees only if they keep a move target across the
  boundary (re-tap otherwise); a richer "queue position / zone N/M full" HUD would help.

**Watch out:** the world is a wrapping `WORLD_WIDTH × WORLD_HEIGHT` ring of sections
(`WORLD_WIDTH = SECTION_WIDTH × CHUNK_COLS`; `CHUNK_ID` is gone — chunks are ids
`0..CHUNK_COLS-1`). A `Chunk`'s `width` is the **global** circumference (wrap), not
its section width; `x0..x1` is its slice. Work-flags are kept inside their section
and clear on a cross-boundary handoff (a known rough edge to revisit with the real
checkpoint). The zoom-out floor is capped at one lap (camera `minScale`) — a taller
world that wraps will want render-side tiling. Two-rate loop, codec, interpolation,
resilience, and build/weld/mining/crew mechanics all carry over unchanged.

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
- **Seam interpolation.** The client unwraps wrapped server X into a *continuous*
  coordinate before interpolating (`EntityStore`); otherwise a robot crossing the
  seam (x≈width → x≈0) lerps backwards across the whole world. The renderer then
  wraps that continuous X to the copy nearest the camera (`Stage.wrapNear`).
