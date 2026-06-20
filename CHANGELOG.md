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
