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

## Next up: **v0.2.0 "First Bolt" 🔩** — the build loop (Phase 1, "prove the fun")

Smallest fun slice that turns wandering dots into a game:

1. **Ghost blueprint** — a few ghost pieces forming a small structure.
2. **Resources** — robot picks up + carries a resource.
3. **Assembly** — deliver → piece goes `ghost → placed`; show `X/Y placed` and a
   "contract complete" state.
4. **One two-robot piece** (hold + weld) — the cooperation-under-lag test, with a
   reservation **TTL** so a dropped partner releases it (design doc §4.7, §10).

Hooks already in place for this (placed in Phase 0 on purpose):
- entity-neutral `EntityKind` (`Piece = 1` reserved), generic `Entity`/snapshot path
- the `DomainEvent` catalogue + `S_EVENT` channel (client already ignores them safely)
- single intent chokepoint (`Chunk.applyIntent`) — new intents slot in here
- `gracePeriodMs`-shaped seam: robot removal isolated in `WsGateway.onClose`

## Gotchas we learned (don't re-discover these)

- **Caddy + WebSocket:** keep `/ws` in its own `handle{}` and out of `basic_auth`.
- **Fresh hosts** often already run nginx on :80 (installer now retires it).
- **TS 6 typed arrays:** encoded frames are typed `Uint8Array<ArrayBuffer>` so the
  browser `WebSocket.send` signature is satisfied (see `shared/codec.ts`).
- **Interpolation timing** uses an arrival-anchored playback clock (not an absolute
  clock offset) — robust to asymmetric injected lag (see `client/main.ts`).
