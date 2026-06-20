# Changelog

How we version (pre-1.0 proof-of-concept):

- **`0.<phase+1>.<patch>`** — each design-doc phase is a minor version with a fun
  **codename + emoji**; patch bumps are fixes/polish within a phase.
- Wire-protocol changes bump `PROTOCOL_VERSION` separately (see `packages/shared`).

| Version | Codename | Phase |
|---|---|---|
| v0.1.0 | First Light 🌅 | 0 — skeleton / prove the pipe |
| **v0.2.0** | **First Bolt** 🔩 | 1 — the build loop / prove the fun ← we are here |
| v0.3.0 | Full House 🏟️ | 2 — scale the population |
| v0.4.0 | Roots 🌱 | 3 — identity & stickiness |
| v1.0.0 | Grand Opening 🎉 | public launch |

_(Codenames past 0.1.0 are tentative — fuel, not a contract.)_

---

## Unreleased — Phase 2 (in progress) 🪐 — the world gets big

Phase 2 grows the world, shipping in slices on the Phase 2 branch (most recent
first). Still one wide chunk; the **chunk grid + OSHA handoff** (and a dedicated
delivery-swarm robot type) are the slices still to come.

### Slice 3 — commandable crews 🚩

Players can now **direct the builder crew**: long-press to plant a **work-flag** and
the crew rallies to mine the area around it (set-and-forget — Ben's pick). The seed
of the commandable AI crews/swarms in the design.

- **Work-flag** (`EntityKind.Flag`) — one per player, planted/moved by a long-press
  (new `C_INTENT_FLAG`); tap your own flag to pick it up; it clears automatically when
  you leave. The owner's robot id rides as `status` so each client renders its own
  flag distinctly (bright green) from others' (amber).
- **Crew rally** — while any flag exists, builders mine the nearest vein to the
  nearest flag (hauling back to the structure), so dropping a flag out by a rich (or
  far) vein sends the whole crew to work it — "set-and-forget far journeys that still
  need coordination." With no flag they fall back to their default roles.
- **Client** — a long-press plants the flag (taps still move/grab/build, drags pan,
  pinch zooms); flags render as a pole-and-pennant standing on the surface.
- **Protocol** → **7**: adds the work-flag intent + flag entity kind.
- **Proven**: unit (62 tests, +4) — flag plant/move/pick-up, a flag cleared when its
  owner leaves, and a builder rallying to the flagged vein over the one next to it.
  Wire (built server, default prospectors off): planting a flag by a far vein made the
  crew mine *that* vein and only it.

### Slice 2 — surface mining ⛏️

Now there's a reason to roam the wide world: **ore veins scattered around the
planet surface** that you mine for material. Depots become the convenient starter;
veins are the wider story (Ben's steer).

- **Ore deposits** (`EntityKind.Deposit`): renewable veins seeded around the planet
  surface, away from the structure — so prospecting means actually walking the
  world. A vein holds a few loads and slowly refills between visits, so heavy use
  depletes it but the planet never runs dry; `status` carries its remaining richness.
- **Mining** through the one `applyIntent` chokepoint: an empty-handed robot taps a
  vein, walks there, **digs for a beat**, and carries off a load — which feeds the
  existing build loop unchanged (deliver/weld don't care where material came from).
  The server resolves pickup-vs-mine-vs-deliver by context; the client never asserts
  it (§4.2).
- **Client**: veins render as faceted ore rocks whose size/brightness track their
  richness (a tapped-out vein dims until it regenerates); tap-to-mine rides the same
  context-resolved tap.
- **Prospector builders**: a configurable share of the autonomous builders
  (`SEED_MINERS`, default 2) now source from veins instead of depots — so the living
  worksite prospects the planet on its own, not just the player. They fall back to a
  depot if no vein has material; the seed of distinct robot roles for the crews slice.
- **Protocol** → **6**: adds the ore-deposit entity kind (wire shape unchanged — it's
  another entity on the existing snapshot path).
- **Proven**: unit (58 tests, +5) — vein extract/refill caps, a robot digging a load
  + emitting a pickup, a tapped-out vein refusing to be mined, mined material
  completing a ghost, and a **prospector builder mining a vein and building from it
  autonomously**. Wire (built server): a client mined a vein (richness 6 → 5); with
  3 prospector bots, 3 of 10 veins were mined autonomously in ~24 s.

### Slice 1 — the wrapping world & surface aesthetic

The single 1024² square becomes a wide **side-scrolling planet whose X axis wraps**
— walk far enough left or right and you arrive back where you started — with a real
**surface, sky, and atmosphere**, the megastructure now standing on the ground and
rising toward the sky. Lays the aesthetic down early and makes the netcode
wrap-ready for the rest of Phase 2 (Ben's steer, 2026-06-20).

**Added**
- **Cylinder geometry** (`shared/world.ts`): `wrapX`, `wrapDeltaX` (shortest signed
  step across the seam), and `wrappedDistance` — the wrap math decided **once** and
  shared byte-for-byte by the server (authoritative) and the client (camera +
  render), the same discipline as the shared codec. Unit-tested incl. seam cases.
- **Surface & sky aesthetic** (`client`): a screen-space backdrop — deep-space
  background, a world-anchored **atmosphere haze** the structure rises into, a
  rim-lit **horizon line**, ground **motion ticks** that scroll as you walk, and a
  gentle **star parallax**. Drawn behind the camera-transformed world so it stays
  seamless everywhere on the planet.
- **Seamless wrap rendering** (`client`): every entity is drawn at the copy of its
  X nearest the camera, and the camera loops around the planet; zoom-out is capped
  at exactly one lap so the cylinder never visibly tiles. The interpolation buffer
  unwraps seam crossings (continuous X), so a robot stepping across the seam glides
  the short way instead of zipping back around the world.

**Changed**
- **World model** (`shared/constants.ts`): `WORLD_SIZE` (square) → `WORLD_WIDTH`
  (wraps) + `WORLD_HEIGHT` + `GROUND_Y` + `WORLD_WRAP_X`. Movement, interaction
  range, nearest-entity search, and the **viewport AOI filter** all now measure X
  the short way around the cylinder — an entity just across the seam from your view
  stays visible instead of popping. Egress per client is unchanged.
- **Blueprint & spawns** (`server`): the contract stands on the surface and rises
  toward the sky; depots spread along the ground to either side; players spawn on
  the surface by the structure and NPCs scatter along the planet so walking around
  it you keep meeting robots at work. Robots are clamped to the surface (Y), free
  around it (X).

**Protocol** — `PROTOCOL_VERSION` → **5**: `S_WELCOME` carries rectangular
`worldBounds` plus `groundY` and `wrapX`, so the client adopts the world geometry
from the server instead of assuming a square. (Raised again to **6** in slice 2.)

**Proven** — unit (53 tests, +11): the wrap math (incl. shortest-path across the
seam), wrap-aware movement, and seam-crossing interpolation continuity. Wire (built
server): boots `4096x1024 wrapX groundY=896`; **8 builder bots placed 11/18 pieces
in ~9 s** in the new surface layout. The Phase 1 build/weld/resilience suite carries
over unchanged.

### Next (still in Phase 2)
- A dedicated **delivery-swarm** robot type (set-and-forget ferrying), and the big
  structural one: the **chunk grid + OSHA handoff** — grow `ChunkRegistry` from one
  wide chunk to many (the AOI filter and wrap math are already ready for it).

---

## v0.2.0 — "First Bolt" 🔩 — 2026-06-20

**Phase 1: the build loop (prove the fun).** Wandering dots became a game: a real
build loop, a living worksite of autonomous builder bots, two-robot cooperative
welding (player *or* AI partner), connection resilience for cheap phones, and a
contract that loops. Played live with three players across two phones and a PC.

### Added
- **Build pieces & resource depots** (`shared`): two new entity kinds (`Piece`,
  `Resource`) on the existing entity-neutral snapshot path, plus a piece assembly
  state machine (`PieceStatus`: ghost → placed for now; reserved/in_progress are
  reserved for the two-robot weld). Robot `status` became a small bitfield so
  "carrying" rides the wire with no extra field — egress per entity is unchanged.
- **Interact intent** (`C_INTENT_INTERACT`): one context-resolved intent — the
  server decides pickup vs deliver and never trusts the client (§4.2). Routed
  through the existing single chokepoint, `Chunk.applyIntent`.
- **The loop** (`server`): walk to a depot → pick up (carry) → walk to a ghost
  piece → deliver → it turns placed. A small seeded contract (a 6-piece block
  flanked by two depots); finishing it fires `ContractCompleted`.
- **Looping contract**: a completed blueprint celebrates briefly, then resets to
  fresh ghosts (`ContractStarted`) so building never dead-ends — the cheap
  "another contract" retention bridge (§2.5).
- **Builder bots / a living worksite**: a configurable share of seeded NPCs
  (`SEED_BUILDERS`) now run the build loop autonomously — haul from the nearest
  depot to the nearest ghost — a little slower than players and with a dawdle, so
  AI bots work but "not as well as players." The blueprint grew to an 18-piece
  block with four spread-out depots so a crowd (AI + human) has room. This is the
  seed of the commandable crew/swarm and the AI weld-partner.
- **Two-robot weld** (`EntityKind.WeldPiece`, §10) — the cooperation-under-lag
  test. The top row of the blueprint needs **two robots**: a *holder* (who brought
  the beam, stays carrying) takes it Ghost → Reserved, then a *welder* joins for
  Reserved → InProgress, and after a short weld both present → Placed. Either role
  can be a **player or an AI bot** — cooperation is available but never forced;
  builder bots pair up to weld on their own and will jump in to partner a player.
  A reservation **TTL** plus per-tick participant checks mean a dropped/leaving
  partner never deadlocks the piece (it releases to ghost, or demotes to awaiting
  a partner) — the same resilience thinking as §4.7. Events: `PieceReserved`,
  `PieceReleased`.
- **Connection resilience (§4.7)** — reconnection is the common case on cheap
  phones, not an edge case:
  - each player robot gets a **session token** (in `S_WELCOME`); the client saves
    it per-tab and presents it on reconnect to **resume the same robot** —
    position and carried item intact — instead of spawning a new one.
  - a dropped owner's robot is **parked** for a grace window (default 2 min,
    `GRACE_PERIOD_MS`) and only then removed, so a phone nap doesn't lose it.
  - client **auto-reconnects** with backoff and nudges immediately when the tab
    becomes visible / the network returns, with a "connection lost — tap to
    retry" overlay.
- **Build-loop domain events** (§6): `ResourcePickedUp`, `PiecePlaced` (with live
  `placed`/`total`), `ContractCompleted`, `ContractStarted`, `RobotReconnected`.
- **Client**: renders ghost vs placed pieces, depots, and a carried-material
  marker above a hauling robot; a tap resolves to grab / deliver / move by
  context; HUD shows `pieces X/Y`, carry state, and live connection status;
  contract banners on complete / new.

### Fixed
- **Delta snapshots now ship non-positional state changes.** A placed piece never
  moves, so the position-only delta path would have silently dropped its
  ghost → placed flip; the delta now restates any entity whose `status` changed.

### Protocol
- `PROTOCOL_VERSION` → **4** (v2: interact intent + piece/resource kinds + status
  bitfield; v3: session token for reconnect resume; v4: weld-piece kind + events).

### Proven
- Unit (42 tests): the build loop + completion (idempotent), the contract loop
  reset, move-cancels-action, empty-handed-deliver no-op, the delta status-change,
  a parked robot holding position + load, an NPC builder autonomously placing a
  piece, **the two-robot weld** (completion + TTL release + holder-drop release +
  welder-leave demote + two bots welding autonomously), and client **reconnect
  resilience** (connect-watchdog, zombie-socket teardown, superseded-socket guard).
- Wire (built server): full build loop at v4; reconnect mid-carry resumes the
  **same robot** (`resumed=true`) with position + load intact across cycles;
  builder bots complete + auto-loop a full contract; and **10 builder bots pair up
  to weld (Reserved → InProgress → Placed) and finish an 18-piece contract — incl.
  6 weld pieces — with no human input**.
- Played live with three players (two phones + a PC).

### Next (Phase 2 territory)
- A side-scrolling landscape that wraps into a circular planet, surface-resource
  search + mining, and the wider aesthetic pass — plus commandable AI crews.

---

## v0.1.0 — "First Light" 🌅 — 2026-06-19

**Phase 0: Skeleton / prove the pipe.** The first end-to-end working system —
robots move around one chunk, server-authoritative, smooth under ~1 s lag — and
it's live on the internet. The project's core bet ("can this feel good over a
laggy connection with many people?") got its first **yes**.

### Added
- **Monorepo** (pnpm + TypeScript, strict): `shared`, `server`, `client`, `bot`.
- **Wire protocol** (`shared`): MessagePack frames, fixed-point (1/16) positions,
  one codec shared byte-for-byte by server, client, and bot.
- **Server**: authoritative two-rate loop (10 Hz sim / 4 Hz broadcast), entity-
  neutral actor-shaped `Chunk`, full-vs-delta `Snapshotter` (the egress lever),
  viewport AOI filter, outbound lag/jitter injection, and `bytes/player/tick`
  metrics (`/metrics`, `/metrics.json`). In-memory only; a `WorldRepo` interface
  marks where Valkey/Postgres slot in at Phase 2/3.
- **Client**: PixiJS v8 (WebGL), pan/zoom infinite-canvas camera, arrival-anchored
  interpolation that smooths 2–5 Hz under lag, click-to-move intents, live HUD.
- **Bot harness**: headless load + lag tester with a per-second egress reporter.
- **Hosting**: one-shot `install.sh` (Caddy auto-HTTPS via sslip.io, password gate,
  `ufw`), `runserver.sh`, `play-local.sh`.
- **Docs**: README (newcomer + developer paths), deploy guide, this changelog,
  `HANDOFF.md`.
- **CI**: typecheck + tests + build on every push/PR.
- **Versioning**: `APP_VERSION` / `APP_CODENAME` in `shared` (surfaced in the
  server boot log and `/health`).

### Proven
- 200 simulated players, **0 errors**, ~6 KB/s per client, tick p95 ~29 ms.
- Full vs delta snapshot egress measured and matched server↔client.
- **Live on the internet** (LA box), rtt ~39 ms, smooth click-to-move with real
  players.

### Fixed (during bring-up)
- `install.sh`: retire a pre-existing nginx/apache holding port 80; validate the
  Caddyfile; robust password hashing; fail loudly instead of reporting false success.
- Caddy: route `/ws` in its own `handle{}` (the SPA `try_files` was rewriting it to
  `index.html`) and exempt `/ws` from `basic_auth` (browsers don't authenticate the
  WebSocket handshake).
