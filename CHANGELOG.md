# Changelog

How we version (pre-1.0 proof-of-concept):

- **`0.<phase+1>.<patch>`** — each design-doc phase is a minor version with a fun
  **codename + emoji**; patch bumps are fixes/polish within a phase.
- Wire-protocol changes bump `PROTOCOL_VERSION` separately (see `packages/shared`).

| Version | Codename | Phase |
|---|---|---|
| **v0.1.0** | **First Light** 🌅 | 0 — skeleton / prove the pipe ← we are here |
| v0.2.0 | First Bolt 🔩 | 1 — the build loop / prove the fun |
| v0.3.0 | Full House 🏟️ | 2 — scale the population |
| v0.4.0 | Roots 🌱 | 3 — identity & stickiness |
| v1.0.0 | Grand Opening 🎉 | public launch |

_(Codenames past 0.1.0 are tentative — fuel, not a contract.)_

---

## [Unreleased] — "First Bolt" 🔩 — Phase 1 in progress

**Phase 1: the build loop (prove the fun).** The single-robot build loop end to
end, plus connection resilience and a looping contract so it's pleasant to play
on real phones. The version stays `0.1.0` until Phase 1 is complete (the
two-robot weld is the last piece); the wire protocol bumps now.

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
- `PROTOCOL_VERSION` → **3** (v2: interact intent + piece/resource kinds + robot
  status bitfield; v3: session token in hello/welcome for reconnect resume).

### Proven
- Unit (31 tests): pickup → carry → deliver → place, contract completion (and
  that it can't fire twice), the contract loop reset, a move intent cancels a
  queued action, an empty-handed deliver is a no-op, the delta status-change
  ships, and a parked robot holds position + keeps its load.
- Wire (built server, both snapshot modes): hello v3 → snapshot carries 6 pieces
  + 2 depots → interacting a depot sets the carry bit → interacting a ghost emits
  `PiecePlaced{placed:1,total:6}` and flips the piece to placed.
- Wire reconnect: drop mid-carry → reconnect with the token → **same robot
  resumed** (`resumed=true`), position and carried item intact.

### Next (completes Phase 1)
- The **two-robot weld** (one holds, one welds) with a reservation **TTL** built
  on this same grace mechanism (§4.7, §10) — cooperation under lag with no
  deadlock when a partner drops. Version bumps to **v0.2.0 "First Bolt" 🔩** then.

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
