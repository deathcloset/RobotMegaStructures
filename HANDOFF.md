# Handoff — pick up here

## Where we are: **v0.1.0 "First Light" 🌅** — Phase 0 done & live

Robots move around one flat chunk, server-authoritative, smooth under ~1 s lag,
hosted on the internet behind HTTPS + a password. This is the **foundation**; the
actual building gameplay is next. Foundation is merged to `main`.

- **Live:** `https://192-154-110-158.sslip.io` (password-gated) — on the LA box.
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

## In progress: **v0.2.0 "First Bolt" 🔩** — the build loop (Phase 1, "prove the fun")

Smallest fun slice that turns wandering dots into a game, split into two
deployable slices:

**DONE so far (on branch `claude/dreamy-cray-20xncu`, PR #2, played live & in review):**
1. ✅ **Ghost blueprint** — a 6-piece block forming a small structure.
2. ✅ **Resources** — robot grabs from a depot and visibly carries material.
3. ✅ **Assembly** — deliver → piece goes `ghost → placed`; HUD `pieces X/Y` +
   "contract complete 🎉" banner.
4. ✅ **Looping contract** — completion celebrates, then resets to fresh ghosts
   (`ContractStarted`) so it never dead-ends (§2.5).
5. ✅ **Connection resilience (§4.7)** — session token in `S_WELCOME`; reconnect
   presents it to **resume the same robot** (position + carried item intact); a
   dropped owner's robot is **parked** for a grace window (`GRACE_PERIOD_MS`,
   default 2 min) before removal; client auto-reconnects + nudges on tab-visible /
   online, with a tap-to-retry overlay.

How it works: one `C_INTENT_INTERACT` (server resolves pickup vs deliver by
context); pieces/resources are new `EntityKind`s on the same snapshot path; robot
`status` is a bitfield (`Moving|Carrying`); build-loop `DomainEvent`s ride
`S_EVENT`. Protocol at **v3** (interact intent + entity kinds @ v2; session token
@ v3). Delta snapshots also ship status changes (a placed piece doesn't move).
Robots now carry `isNpc` (wander) vs controlled vs `parked` (dropped, awaiting
return). Version stays 0.1.0 until the weld lands.

**LAST PIECE — two-robot weld (NEXT, completes Phase 1 → v0.2.0):**
6. **One two-robot piece** (hold + weld) — the cooperation-under-lag test, with a
   reservation **TTL** so a dropped partner releases it. The grace mechanism it
   pairs with (§4.7, §10) now exists, so this is the focused remaining work.

Hooks in place for it:
- `PieceStatus.Reserved` / `InProgress` already defined (entities.ts)
- the `DomainEvent` catalogue + `S_EVENT` channel — reserve `PieceReserved`,
  `PieceReservationExpired` next
- single intent chokepoint (`Chunk.applyIntent`) — the weld intent slots in here
- grace-period machinery (token sessions + `graceTimers` + parking) is live in
  `WsGateway`; a piece reservation TTL is the same shape applied to pieces

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
