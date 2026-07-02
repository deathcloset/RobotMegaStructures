# Handoff — pick up here

## Where we are: **v0.3.0 "Full House" 🏟️** — Phase 2 milestone on `main`

The planet scaled up. A **wrapping ring of numbered sections** (the chunk grid) with
per-viewport interest (an **8.5×** egress cut, flat as the world grows), **OSHA caps +
checkpoints** that throttle the bot swarm while never walling a human, **roaming work
crews** drawn to a rotating hot zone (queues that form *and* drain — bots give up after a
bounded wait), **varied-cap zones** with live floating labels, and **nested zones** —
capped interior chambers you opt into through a gate. Plus the gameplay: **surface
mining**, **commandable crews** (work-flags), the two-robot **weld**, looping contracts,
reconnect-resume (§4.7), and the surface/sky aesthetic. Phases 0–2 (`v0.1.0`–`v0.3.0`)
are all on **`main`**; the chunk grid + `settle` handoff are the proven seam for
multi-server (the next infra arc). Protocol **v12** (v11 added the emoji
emote/celebration events; v12 adds the **klepto alien** 👾 — Phase 3's first
slapstick system: it lands, pries off a placed piece, and flees; corner it with
TWO robots to capture it. `sim/Klepto.ts` holds the critter + every tunable;
`Chunk.advanceKlepto` owns the state machine; `ChunkRegistry.advanceKleptoSpawner`
enforces one-alive-planet-wide + the 2–4 min cadence, `KLEPTO_MIN_MS`/
`KLEPTO_SPAN_MS` to tune. It is deliberately NOT a robot: no OSHA slot, invisible
to `settle()`, clamped inside its section — nothing about the multi-server seam
moved). Longer-horizon ideas live in
[`IDEAS.md`](./IDEAS.md) (fuel, not roadmap — §2.5).

- **Live:** `https://192-154-110-158.sslip.io` (password-gated) — on the LA box.
- **What it is / isn't:** README + design doc §9. Scope discipline: design doc §2.5.
- **Merged (PR #4, on `main`):** Phase 2 continued — **slice 8: the vault worksite**
  (the nested vault has its own interior contract a resident crew builds and a player
  can join; loops on its own, zone-scoped via an internal `zoneId`); **slice 9:
  delivery-swarm couriers** (plant a work-flag → a swarm of `isCourier` bots ferries
  material to that section from across the planet and builds it;
  `ChunkRegistry.flagSection()` + `SimLoop` point them at the flag). Both server-only.
  See CHANGELOG "Unreleased".

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
  mine the flagged area; tap your own flag to pick it up. Now also a **delivery-swarm**
  (slice 9): couriers ferry material to the flagged section from across the planet and
  build it — set-and-forget far ferrying.
- ✅ **Chunk grid + OSHA handoff + nested zones** (slices 4–7, this branch) — the planet
  is a ring of **numbered zones**; interest is per-viewport (8.5× egress cut measured);
  robots hand off across boundaries; **caps vary** per zone, each shows a live `count/cap`
  label, **roaming work crews** make checkpoints visibly queue, and **players queue
  briefly** at a full ring zone but are force-admitted (felt, never walled). **Nested
  zones** add a capped interior **chamber** you opt into through a gate — a hard cap
  (queue at the gate, or walk on by) (§4.4).
  **Next:** real multi-server distribution (IDEAS.md "Distributed hosting" — Ben's vision:
  sections across small boxes; the `settle` handoff + cap are the seam).
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
- **Nested zones (built, slice 7):** a `NestedZone` owned by its parent `Chunk` — a capped
  interior **chamber** with a gate (`EntityKind.Gate`) on the surface. Entry is opt-in
  (tap the gate → `pendingAction: 'enter'` → walk to it → ascend into the chamber) and the
  cap is **hard** (no force-admit — the opposite of the ring checkpoints, since entry is a
  choice). Occupants stay in the parent's `robots` map (still simulated), flagged
  `Robot.insideZone` + lifted into the chamber, and ride the same `S_SECTIONS` list (now
  with `x`/`y`/`nested`). Seeded in `index.ts` §1 with `NESTED_ZONE_CAP` (geometry
  constants `NESTED_ZONE_*` in shared; the section + id bases are in `index.ts`). Future
  for it: NPC builders/crews actually **working** inside a chamber (it has no worksite of
  its own yet — residents just hold slots), multiple nested zones / named vaults, and
  literal walk-*around* collision (today traversers pass underneath, which reads fine).
- **Multi-server:** the same `settle` handoff becomes a *network* handoff; `ChunkRegistry`
  becomes the seam where a section is owned by another process/box, coordinated over
  Redis/Valkey. See IDEAS.md "Distributed hosting" (Ben's capacity/failover vision).
  Don't build it until there's a second box to host (no consumer yet, §2.5).
- **Checkpoint dynamics (tunables):** wanderers roam + builder crews migrate (drawn to a
  clock-derived rotating hot section), so checkpoints fill and queue in waves; **players
  queue briefly then are force-admitted** (`MAX_PLAYER_WAIT_MS` in `ChunkRegistry.ts`),
  so a tight zone is felt but never walls a human. **Bots that queue past
  `BOT_QUEUE_PATIENCE_MS` (5 s) give up and turn back into their own section** — the
  release valve that stops mutually-full sections from deadlocking (queues stay lively
  but drain in waves; the `queued` gauge rises and falls rather than climbing to a frozen
  plateau). Caps **vary per zone** (`CAP_MULT` + `MIN_SECTION_CAP` in `index.ts`, anchored
  to `SECTION_CAPACITY`) and each section's crew scales to its cap (`pop = capacity − 3`).
  Other knobs: `crewAi.ts` (`RELOCATE_*`, `HOT_PERIOD_MS`, `HOT_BIAS`, dawdle/beat
  timings — the builder/courier brains live there now, called from `Chunk.step`);
  watch the `queued` gauge in the metrics log.

**Watch out:** the world is a wrapping `WORLD_WIDTH × WORLD_HEIGHT` ring of sections
(`WORLD_WIDTH = SECTION_WIDTH × CHUNK_COLS`; `CHUNK_ID` is gone — chunks are ids
`0..CHUNK_COLS-1`). A `Chunk`'s `width` is the **global** circumference (wrap), not
its section width; `x0..x1` is its slice. Work-flags are planted inside a section but
**survive their owner's cross-boundary handoffs** (set-and-forget ferrying) — they
clear only on pickup, replant, or the owner's grace expiry;
`ChunkRegistry.applyIntent`/`clearFlagOf` coordinate the one-flag-per-player
invariant across sections (chunks still never touch each other; known quirk: tapping
your remote flag while inside a vault steps you out of the chamber, consistent with
"tapping floor work leaves the chamber").
The zoom-out floor is capped at one lap (camera `minScale`) — a taller
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
