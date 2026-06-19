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

**Slice 1 — single-robot build loop (DONE, on branch `claude/dreamy-cray-20xncu`, in review):**
1. ✅ **Ghost blueprint** — a 6-piece block forming a small structure.
2. ✅ **Resources** — robot grabs from a depot and visibly carries material.
3. ✅ **Assembly** — deliver → piece goes `ghost → placed`; HUD shows `pieces X/Y`
   and a "contract complete 🎉" banner fires on completion.

How it works: one `C_INTENT_INTERACT` (server resolves pickup vs deliver by
context); pieces/resources are new `EntityKind`s on the same snapshot path; robot
`status` is now a bitfield (`Moving|Carrying`); build-loop `DomainEvent`s
(`ResourcePickedUp`, `PiecePlaced`, `ContractCompleted`) ride `S_EVENT`. Protocol
bumped to **v2**. Delta snapshots now also ship status changes (a placed piece
doesn't move). Version stays 0.1.0 until slice 2 lands.

**Slice 2 — two-robot weld (NEXT, completes Phase 1):**
4. **One two-robot piece** (hold + weld) — the cooperation-under-lag test, with a
   reservation **TTL** so a dropped partner releases it, designed together with
   the disconnect **grace period** (design doc §4.7, §10). This is where the
   `PieceStatus.Reserved`/`InProgress` states (already defined) and the
   `WsGateway.onClose` grace-period seam get used.

Hooks still in place for slice 2 (placed in Phase 0/1 on purpose):
- `PieceStatus.Reserved` / `InProgress` already defined (entities.ts)
- the `DomainEvent` catalogue + `S_EVENT` channel — reserve `PieceReserved`,
  `PieceReservationExpired` next
- single intent chokepoint (`Chunk.applyIntent`) — the weld intent slots in here
- `gracePeriodMs`-shaped seam: robot removal isolated in `WsGateway.onClose`

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
