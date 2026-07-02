# Changelog

How we version (pre-1.0 proof-of-concept):

- **`0.<phase+1>.<patch>`** — each design-doc phase is a minor version with a fun
  **codename + emoji**; patch bumps are fixes/polish within a phase.
- Wire-protocol changes bump `PROTOCOL_VERSION` separately (see `packages/shared`).

| Version | Codename | Phase |
|---|---|---|
| v0.1.0 | First Light 🌅 | 0 — skeleton / prove the pipe |
| v0.2.0 | First Bolt 🔩 | 1 — the build loop / prove the fun |
| **v0.3.0** | **Full House** 🏟️ | 2 — scale the population ← we are here |
| v0.4.0 | Roots 🌱 | 3 — identity & stickiness |
| v1.0.0 | Grand Opening 🎉 | public launch |

_(Codenames past 0.1.0 are tentative — fuel, not a contract.)_

---

## Unreleased — Phase 2, continued 🚧

Building on the v0.3.0 architecture (most recent first).

### Foundation pass — solid ground before new features 🧱

A hardening/polish sweep of the systems we already have (Ben's steer, 2026-07-02):
resilience, rough edges, hygiene — plus one bit of language-neutral fun.

- **Work-flags survive crossing sections** (behavior fix): planting a flag and
  walking across a boundary used to silently delete it — undermining slice 9's
  set-and-forget couriers. A flag now stays planted until its owner picks it up,
  replants it, or their reconnect grace expires. `ChunkRegistry.applyIntent` is the
  single intent entry point and coordinates the one-flag-per-player invariant
  planet-wide (chunks stay isolated actors — the multi-server seam is untouched).
- **Emoji emotes + vault celebration 🎉** (fun, deliberately language-agnostic —
  emoji only, never words, so the game reads the same on every phone in every
  language): robots pop an emoji at work milestones (🔩 placed, ⚡🤝 weld, ⛏️💎 dig),
  the whole section crew reliably cheers a completed contract, and the nested
  vault's interior contract — previously silent — now fires `VaultCompleted` with a
  burst of celebration emoji at the chamber. Server-picked, per-robot cooldown +
  probability gate keep it sparse (~30 bytes/event, milestone-bounded).
  **Protocol → 11** (two new event ids; wire shape unchanged).
- **Tick-loop crash guard** (resilience): an exception inside a tick no longer
  kills the whole server — it's logged loudly (`tick_errors` metric) and the loop
  keeps scheduling; ten *consecutive* failures escalate to a visible crash so a
  structurally broken sim restarts under its supervisor instead of zombie-ing.
- **Chunk.ts split + dedupe** (no behavior change): the builder/courier brains
  moved to `sim/crewAi.ts`; one generic wrap-aware `nearest()` replaced five
  hand-rolled scan loops; the unnamed tunables got names (`AI_SPEED_FACTOR`,
  dawdle/beat timings, spawn bands, `CREW_CAP_MARGIN`…). Chunk.ts: 883 → ~710 lines.
- **CI now lints** (Biome ran locally since Phase 0 but was never enforced) and the
  README/package.json/HANDOFF version-and-branch drift is synced to v0.3.0 reality.
- **Proven**: unit (108 tests, +10 and one updated) — flag persistence across
  handoffs/replants/pickup/expiry, crash-guard survive + escalate, reliable
  contract celebration, emote cooldown, once-per-completion vault events; the
  full pre-existing suite passes unmodified through the refactor.

### Slice 9 — delivery-swarm couriers 🚚

The work-flag grows a **logistics** arm: plant it and a **swarm of couriers** ferries
material to that section from across the planet and builds it — set-and-forget supply
lines. (Builders rally to *mine* near the flag; couriers *deliver* to it — two robot
types, one command.) With no flag, couriers just help build their own section.

- **New courier role** (`isCourier`, `SEED_COURIERS` per section): a courier grabs a load
  from the nearest depot wherever it is, carries it across the checkpoints to the flagged
  section, delivers (builds a ghost), then heads back out to source another. Distinct from
  a builder, who migrates *empty* and mines.
- **Planet-wide flag awareness**: `ChunkRegistry.flagSection()` finds the section holding
  a work-flag; `SimLoop` passes it into each section's step, so couriers everywhere
  converge on your flag. (One flag served for now; nearest-flag routing is a future
  refinement.)
- **Visible without a wire change** (still v10): a courier is just an NPC carrying a load
  across boundaries toward your flag — the cargo marker already rides the snapshot, and
  `isCourier` is server-internal.
- **Rides the deadlock-safe checkpoints**: a ferrying courier queues at a full checkpoint
  and gives up / turns back like any bot, so supply lines never gridlock.
- **Proven**: unit (98 tests, +4) — `flagSection` detection, a courier ferrying a load
  across two sections to the flagged one and building it, a courier picking up + setting
  its heading, and a no-flag courier building locally. Wire (live server,
  `SEED_COURIERS=3`): planting a flag grew that section's population as couriers ferried
  in (5 → 8 → 11, loads in hand) while the planet total held steady.

### Slice 8 — the vault worksite 🏗️

The nested **vault** (v0.3.0) gets a **reason to enter**: its own interior **contract**.
A small row of ghost pieces + a depot float up in the chamber; the resident crew builds
them and a visiting player can join in — all without touching the section's contract on
the floor outside.

- **Zone-scoped build loop** (server-only): pieces and depots carry an internal `zoneId`.
  A crew *inside* the vault builds only the vault's ghosts from the vault's depot; a crew
  on the section floor builds only the section contract and ignores the chamber. Welds,
  work-flags, and prospecting stay section-floor concerns.
- **Doesn't stall the section**: vault pieces are counted separately, so the section
  contract completes + loops on its own even if nobody ever enters the vault.
- **The vault loops on its own** (`advanceVaults`, faster than the section): once its
  ghosts are built it holds a brief beat, then resets — so the chamber is always a living
  worksite with a fresh window to help. The resident crew are now builders.
- **No protocol change** (still v10): vault pieces/depot ride the existing entity path as
  ordinary pieces/resources at chamber positions; `zoneId` is server-internal.
- **Proven**: unit (94 tests, +6) — a player enters and builds the vault piece without
  leaving or touching the section contract, a resident builds it autonomously, an outside
  builder ignores the vault, the section completes without the vault, the vault loops
  (rebuilds after a beat), and tapping floor work leaves the chamber. Wire (live server):
  the resident crew built the chamber's 3 interior pieces while the six section contracts
  progressed independently.

---

## v0.3.0 — "Full House" 🏟️ — 2026-06-29 — the world gets big

**Phase 2: scale the population.** The single 1024² square grew into a **wrapping
planet** — a ring of **numbered sections** (the chunk grid) with per-viewport interest
(an **8.5×** egress cut, flat as the world grows), **OSHA caps + checkpoints** that
throttle the autonomous bot swarm while never walling a human, **roaming work crews**
drawn to a rotating hot zone, **varied-cap zones** with live floating labels, and
**nested zones** — capped interior chambers you opt into. Plus the gameplay to fill it:
**surface mining**, **commandable crews** (work-flags), and the wider **surface/sky
aesthetic**. The chunk grid + the `settle` handoff are the proven seam for
**multi-server distribution** (the next infra arc). Protocol **v10**. Shipped in slices
(most recent first).

### Slice 7 — nested zones 🪆

The first **zone within a zone**: a capped interior **chamber** (a "VAULT") that sits
*inside* a section rather than tiling the ring — "a part of the structure in the middle
of other parts." It floats above the surface, so robots traversing the section pass
**underneath** it; entering is **opt-in** (tap its gate), and because it's a choice, the
cap is **hard** for everyone — you queue at the gate for a spot, or walk on by.

- **A nested zone is "just another zone with a cap"** — it carries a capacity + live
  occupancy and rides the **same `S_SECTIONS` label list** as the ring sections (it just
  carries its own label anchor, since a chamber doesn't sit at a section centre). The
  cap/label/queue model from slice 6 already covered it; this slice is the geometry + the
  opt-in entry. New `NestedZone` (owned by its parent `Chunk`, so it shards with the
  parent later); occupants stay in the parent's robot set, just flagged and lifted up
  into the chamber.
- **Opt-in entry via a gate** (new `EntityKind.Gate`): tap the gate → your robot walks
  to it and **ascends into the chamber**; tap again (or tap to move off) to leave. A
  traverser crossing the section is **never auto-pulled in** — the gate is the only way
  in. The server resolves enter/leave/queue from context (§4.2); the gate reddens when
  the chamber is full.
- **Hard cap — the deliberate contrast with the ring checkpoints**: the ring never walls
  a *traverser* (players force-admit after a bounded wait). A nested zone is the opposite
  — entry is a choice, so the cap is real: a full chamber **queues** you at the gate until
  a slot frees (no force-admit). A small resident crew fills `cap − 1`, so the limit is
  felt right away. `NESTED_ZONE_CAP` (default 3) tunes it.
- **Client**: the gate renders as a doorway on the surface (cyan → red when full); the
  chamber draws as an enclosure up in the structure with a distinct **◆ VAULT n/m**
  label; robots inside cluster within it. The geometry is shared (`NESTED_ZONE_*`) so the
  render matches server placement.
- **Protocol → 10**: the gate entity kind, plus `x`/`y`/`nested` on `SectionInfo` (so a
  nested zone's label floats at its chamber and the client styles/encloses it).
- **Proven**: unit (87 tests, +9) — opt-in entry, the hard-cap queuing *without*
  force-admit (the ring's opposite), a queued player admitted the moment a slot frees,
  leaving via the gate / a manual move / departing the section, never auto-pulling a
  traverser in, and the gate's full-status flip. Wire (cap 2, one resident): `S_SECTIONS`
  carries `V100 1/2`; player A taps the gate and **enters** (count → 2/2, gate reddens,
  robot ascends), player B taps the **full** gate and is **held at it** (count stays 2/2)
  — the hard cap, end-to-end at v10.

> **Playtest catch (Ben), fixed here:** the *ring* checkpoints could **deadlock** —
> roaming crews all piled into the rotating hot section, and since no bot ever yielded,
> mutually-full sections froze each other (everything ground to a halt at the queue
> lines). Fixed with a release valve: a bot queued past `BOT_QUEUE_PATIENCE_MS` (5 s)
> **gives up and turns back into its own section**, so queues stay lively but always
> drain. Verified: under heavy pressure the `queued` gauge now rises and falls in **waves**
> (peaks ~6, draining to ~1) instead of climbing to a frozen plateau. (Players are still
> never walled — they force-admit; only bots give up.)

### Slice 6 — numbered zones + varied caps 🪧

The sections become **places you can read**. Each zone floats its **number and live
`count/cap`** above the structure (reddening to **FULL** when packed), and the ring is
now a **mix of tight and roomy** zones — some are real bottlenecks you queue through,
others have room to spare — so crossing the planet means reading the crowd and
sometimes waiting your turn.

- **Varied caps + populations** (`CAP_MULT` in `index.ts`, anchored to
  `SECTION_CAPACITY`): the six zones cap at e.g. **12/5/16/8/4/14**, and each section's
  seeded crew **scales to its own cap** (kept a margin below it), so tight zones stay
  sparse and roomy ones bustle — the planet reads as varied, not uniform.
- **Zone labels** (`S_SECTIONS`): the server sends each section's cap + live occupancy
  — global and tiny (a handful of sections, encoded once for everyone), so the client
  can label zones it can't even see. The client floats a counter-scaled `ZONE n` +
  `count/cap` label above each section, reddening to **FULL**. Protocol → **9**.
- **Players now queue (briefly) too**: a player crossing into a full zone is **held at
  the checkpoint** — the queuing is *felt* — but **force-admitted after a bounded wait**
  (`MAX_PLAYER_WAIT_MS`, 3 s) so a tight zone can never wall a human. (Slice 5 let
  players pass instantly — right for "never walled," but it made a tight zone invisible.
  This keeps both: felt, never frustrating.) The nudge is now "🦺 Section full — waiting
  at the checkpoint…".
- **Prepping nested zones** (no new geometry yet, per Ben's steer): a "nested" zone — a
  worksite *inside* other parts of the structure with its own small cap — is,
  mechanically, **just another zone with a cap**. The per-section cap model + the labels
  + the bounded queue already cover it; what's left for that slice is *geometry* — an
  interior region a traverser can **walk around** (passing through is opt-in) while it
  still **queues** anyone who wants in. Captured now so the next slice is layout, not
  plumbing.
- **Proven**: unit (78 tests, +2) — per-section caps reported as zone stats, and a
  player queued-then-force-admitted at a full zone (never walled). Wire (dense config
  that previously *walled* players): boots `sectionCaps: 12/5/16/8/4/14`; zone labels
  stream live (`Z1 11/12 · Z2 5/5 FULL · Z3 8/16 …`); a player traversed three zones
  incl. a full one without getting stuck, and the `queued` gauge climbed as roaming
  crews bunched at the tight checkpoints.

### Slice 5 — OSHA caps + the checkpoint 🦺

Each section has an **OSHA cap** that throttles the autonomous **bot** swarm — the
§4.4 sharding boundary. When a section is full, arriving bots **queue at the
checkpoint** until a slot frees. **Players are never walled** — frustrating a human at
an invisible boundary has no place in a co-op game — so you always pass, with a brief
"🦺 busy section" flavour nudge if it's packed.

- **Per-section cap** (`SECTION_CAPACITY`). The handoff (`ChunkRegistry.settle`) holds a
  *bot* at a full section's checkpoint (clamped just inside its current section) and
  lets it cross once a slot frees; admissions are counted so a burst can't overfill.
  Players pass regardless; new players spawn into a section with room.
- **Bots flow, and queue** — NPCs roam between sections: wanderers drift the whole
  planet and builder **work crews migrate** section-to-section, biased toward a rotating
  "hot" section (clock-derived, no shared state) so crews converge and a focus area's
  checkpoints visibly back up, then clear as it moves on. The seeded garrison can never
  saturate a section (effective cap floats a margin above the seed), so it's queue-and-
  flow, not gridlock. A `queued` gauge in the metrics log makes the pressure observable.
- **Feedback**: a player squeezing past a full section gets a throttled `SectionFull`
  event → a "🦺 Busy section — squeezing past the checkpoint" toast (flavour, never a
  block). Protocol → **8**.
- **Proven**: unit (76 tests, +8) — a bot queued at a full checkpoint, a player passing
  one (flavour nudge), no overfill under a burst, a queued bot crossing once a slot
  frees, spawn avoiding a full section, the `queued` gauge, and a roaming builder
  migrating out of its section. Wire (dense config that had *walled* players): players
  cross freely; with roaming crews + the rotating hot section, checkpoints visibly queue
  (up to ~16 bots waiting, ~22 bunched at boundaries) and clear in waves — no gridlock.

> Two playtest catches, both fixed here (Ben's calls): **(1)** the first cut
> hard-blocked *players* at full sections — and since seeded bots never left their
> section, a section seeded to its cap was a permanent wall (sit there forever). Now
> players always pass and the cap can't sit at/below the seed. **(2)** With everyone
> passing there was then *no queue at all* — so builder crews now roam (drawn to a
> rotating hot section), making checkpoints actually fill and queue.

### Slice 4 — the section grid + interest management 🧩

The "prove the architecture" half. The planet is now a **ring of sections** (the
chunk grid): each a self-contained worksite with its own slice of the megastructure,
depots, veins, and crew. A client subscribes only to the section(s) under its
viewport, so **per-client bandwidth stays flat as the world grows** — the core
scaling claim (§7). Robots hand off between sections as they cross the boundaries.
(OSHA caps + the queue-when-full checkpoint *feel* are the next slice; this is the
grid + interest + membership half — the staged plan Ben picked.)

- **Section grid** (`CHUNK_COLS` × `SECTION_WIDTH`): `WORLD_WIDTH` is now derived
  from the grid, so more sections = a bigger planet. `ChunkRegistry` grew from "one
  chunk" into the grid + the routing/interest indirection; each `Chunk` owns a
  world-X slice but still simulates in world coords with the global wrap.
- **Interest across sections**: the broadcast snapshots each section once, then each
  client gathers only the sections overlapping its viewport (`chunksInView`, wrap-
  aware). Measured: in a 6-section world (~190 entities), a viewport client pulled
  **~1 KB/s (19 entities)** vs a whole-world client's **~9 KB/s (188)** — an **8.5×**
  cut, independent of world size.
- **Cross-section handoff** (`ChunkRegistry.settle`): a robot that walks out of its
  section is moved to the one that now owns its position — the in-process form of the
  §4.4 checkpoint handoff, and the exact seam that becomes a *network* handoff when
  sections live on different servers (see `IDEAS.md` "Distributed hosting").
- **Per-section worksites**: every section seeds its own contract + crew; the gateway
  routes each intent to the robot's current section; the HUD shows your zone.
- **No protocol change** (still v7): entities already ride the wire by world position
  and the client already renders by AOI, so the grid is almost entirely server-side —
  the early entity-neutral + AOI hooks paying off.
- **Proven**: unit (68 tests, +6) — `chunkColOf` routing, `chunksInView` selection,
  and a robot handed off to the section it walks into. Wire: the 8.5× egress cut
  above, and a walker crossing a section boundary, tracked continuously.

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
- A dedicated **delivery-swarm** robot type (set-and-forget ferrying between sections).
- Later (infra): real **multi-server distribution** — sections owned by different
  boxes, coordinated over Redis/Valkey; the `settle` handoff + `SECTION_CAPACITY` cap
  built here are the seam for it (see `IDEAS.md` "Distributed hosting").

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
