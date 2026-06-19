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
