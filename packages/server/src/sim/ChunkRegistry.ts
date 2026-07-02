import {
  CHUNK_COLS,
  type ClientMessage,
  chunkColOf,
  GROUND_Y,
  MessageType,
  SECTION_WIDTH,
  type SectionInfo,
  wrapDeltaX,
} from '@rms/shared';
import { Chunk, flagIdOf } from './Chunk';
import type { Robot } from './Robot';

/** A player held at a full checkpoint is force-admitted after this long, so a tight
 *  zone is *felt* but can never wall a human (sections drain anyway as bots roam). */
const MAX_PLAYER_WAIT_MS = 3000;
/** A *bot* held at a full checkpoint this long gives up and turns back into its own
 *  section, so the queue drains instead of freezing. Without this, mutually-full
 *  sections deadlock — nobody yields, no slot ever frees, everything grinds to a halt.
 *  Long enough that the queue is visibly *felt*, short enough that it always clears. */
const BOT_QUEUE_PATIENCE_MS = 5000;
/** Ring-section labels float this far above the surface (nested zones carry their
 *  own anchor — they sit up in the chamber). */
const RING_LABEL_DY = 420;

/**
 * The chunk grid (§4.3): the planet's circumference tiled by `CHUNK_COLS` sections,
 * each a self-contained worksite. This registry is the one indirection between
 * "one chunk" and "many" — and, later, between "many chunks in one process" and
 * "chunks spread across sim servers" (§4.5). The sim loop, gateway, and broadcast
 * all go through it instead of reaching for a single chunk.
 */
/** A checkpoint nudge: `connId` is queued at (or squeezing past) a full section. */
export interface BlockedNotice {
  connId: number;
  section: number;
}

export class ChunkRegistry {
  private readonly chunks: Chunk[] = [];

  /** `capacity` is a single OSHA cap for every section, or a per-section array
   *  (sections vary — some tight, some roomy). Missing/absent entries are uncapped. */
  constructor(capacity: number | number[] = Number.POSITIVE_INFINITY) {
    for (let c = 0; c < CHUNK_COLS; c++) {
      const cap = Array.isArray(capacity) ? (capacity[c] ?? Number.POSITIVE_INFINITY) : capacity;
      this.chunks.push(new Chunk(c, cap));
    }
  }

  /** Per-zone cap + live occupancy for the client's zone labels: every ring section,
   *  then each section's nested zones appended — a nested zone is "just another zone
   *  with a cap," so it rides the same list (it just carries its own label anchor). */
  sectionStats(): SectionInfo[] {
    const out: SectionInfo[] = this.chunks.map((c) => ({
      id: c.id,
      cap: Number.isFinite(c.capacity) ? Math.round(c.capacity) : 0,
      count: c.occupantCount,
      x: c.centerX,
      y: GROUND_Y - RING_LABEL_DY,
      nested: false,
    }));
    for (const c of this.chunks) out.push(...c.zoneStats());
    return out;
  }

  get(id: number): Chunk | undefined {
    return this.chunks[id];
  }

  /** A convenient default section (section 0). */
  get primary(): Chunk {
    return this.chunks[0]!;
  }

  /** Where a new player spawns: the primary section if it has room under the OSHA
   *  cap, else the first section that does (so a join never overfills a section).
   *  Falls back to the primary if every section is full. */
  spawnSection(): Chunk {
    if (!this.primary.isFull) return this.primary;
    for (const c of this.chunks) if (!c.isFull) return c;
    return this.primary;
  }

  all(): IterableIterator<Chunk> {
    return this.chunks.values();
  }

  /** The section owning a world-X. */
  chunkAt(x: number): Chunk {
    return this.chunks[chunkColOf(x)]!;
  }

  /**
   * Sections whose slice overlaps a client's viewport, measured the short way
   * around the cylinder (§4.3). A client that reported no viewport (infinite half-
   * width) sees every section — the worst-case fan-out the headless bots use. As
   * the world grows (more sections), a viewport client still only gets the 1–2
   * sections under its view, so per-client egress stays flat (§7).
   */
  chunksInView(cx: number, halfW: number, margin = 64): Chunk[] {
    if (!Number.isFinite(halfW)) return [...this.chunks];
    const reach = halfW + margin + SECTION_WIDTH / 2;
    return this.chunks.filter((c) => Math.abs(wrapDeltaX(cx, c.centerX)) <= reach);
  }

  /** Find a robot across all sections (robot ids are unique planet-wide). */
  getRobot(robotId: number): Robot | undefined {
    for (const c of this.chunks) {
      const r = c.getRobot(robotId);
      if (r) return r;
    }
    return undefined;
  }

  /** The section currently holding a robot — where its intents are applied. */
  chunkOfRobot(robotId: number): Chunk | undefined {
    for (const c of this.chunks) if (c.getRobot(robotId)) return c;
    return undefined;
  }

  /**
   * Route an intent to the robot's current section, coordinating the few
   * cross-section concerns on the way — the one-flag-per-player invariant is
   * planet-wide, and a planted flag may sit sections away from its owner (it
   * survives checkpoint handoffs; § Phase 2 logistics). Chunks stay isolated:
   * only this registry reaches across sections.
   */
  applyIntent(robotId: number, msg: ClientMessage): void {
    // Replanting moves THE flag: clear the old one wherever it lives, then let the
    // robot's section plant the new one.
    if (msg.t === MessageType.C_INTENT_FLAG) this.clearFlagOf(robotId);
    this.chunkOfRobot(robotId)?.applyIntent(robotId, msg);
    // Tapping your own flag picks it up even from across a boundary (a viewport can
    // see into the next section). The local pickup already happened in applyIntent
    // when robot and flag share a section — this sweep is idempotent.
    if (msg.t === MessageType.C_INTENT_INTERACT && msg.targetId === flagIdOf(robotId)) {
      this.clearFlagOf(robotId);
    }
  }

  /** Remove a player's work-flag wherever it's planted (pickup / replant / a true
   *  removal at grace expiry). */
  clearFlagOf(robotId: number): void {
    for (const c of this.chunks) c.clearFlag(robotId);
  }

  /** Remove a robot wherever it lives (grace expiry / disconnect). A true removal —
   *  unlike a checkpoint handoff — takes the player's planted flag with it. */
  removeRobot(robotId: number): void {
    this.chunkOfRobot(robotId)?.removeOccupant(robotId);
    this.clearFlagOf(robotId);
  }

  /** Where the delivery swarm should carry material: a section holding a work-flag
   *  (searched planet-wide), or null if none is planted. The first flag found wins —
   *  couriers serve one flag for now (§ Phase 2 logistics). */
  flagSection(): number | null {
    for (const c of this.chunks) if (c.hasFlags) return c.id;
    return null;
  }

  /** How many bots are currently held (queued) at a checkpoint — for the metrics
   *  readout, so checkpoint pressure is observable. */
  queuedCount(): number {
    let n = 0;
    for (const c of this.chunks) for (const r of c.occupants()) if (r.blocked) n += 1;
    return n;
  }

  /**
   * The cross-section handoff at the OSHA checkpoint (§4.4). A robot that walked out
   * of its section is moved to the one that now owns its position. The cap throttles
   * the autonomous **bot** swarm: a bot entering a full section is held at the
   * checkpoint (clamped just inside its current section) and crosses on a later tick
   * once a slot frees. **Players are never walled** — frustrating a human at an
   * invisible boundary has no place in a co-op game; a player crossing a full section
   * passes through and just gets a flavour nudge. Returns those nudges for the
   * gateway to deliver. In one process this is a Map move; it's the same seam that
   * becomes a network handoff when sections live on different servers.
   */
  settle(now = 0): BlockedNotice[] {
    const moves: Array<{ from: Chunk; to: Chunk; robot: Robot }> = [];
    const incoming = new Map<number, number>(); // section id -> arrivals already approved
    const notices: BlockedNotice[] = [];
    const edge = 2; // hold a hair inside the current section

    for (const from of this.chunks) {
      for (const robot of from.occupants()) {
        if (from.contains(robot.x)) {
          robot.blocked = false;
          robot.queuedSince = 0;
          continue;
        }
        const to = this.chunkAt(robot.x);
        if (to === from) {
          robot.blocked = false;
          robot.queuedSince = 0;
          continue;
        }
        const approved = incoming.get(to.id) ?? 0;
        const full = to.occupantCount + approved >= to.capacity;
        if (full) {
          const isPlayer = !robot.isNpc && robot.ownerConnectionId !== null;
          if (robot.queuedSince === 0) robot.queuedSince = now;
          const waited = now - robot.queuedSince;
          // A player is force-admitted after a bounded wait (never wall a human). A BOT
          // that's queued too long instead GIVES UP: it abandons the crossing and turns
          // back into its own section, so the queue drains rather than deadlocking
          // (mutually-full sections would otherwise freeze — nobody yields, no slot
          // frees). Queues still form (and are felt); they just self-clear.
          const forceAdmit = isPlayer && waited >= MAX_PLAYER_WAIT_MS;
          if (!forceAdmit) {
            if (!isPlayer && waited >= BOT_QUEUE_PATIENCE_MS) {
              robot.migratingTo = null; // give up heading for that (full) section
              robot.blocked = false;
              robot.queuedSince = 0;
              robot.setTarget(
                from.centerX + (Math.random() * 2 - 1) * (SECTION_WIDTH / 2 - 48),
                from.groundY - 40 - Math.random() * 180,
              );
              continue;
            }
            // Queue at the checkpoint, held just inside the current section.
            const rightNeighbor = (from.id + 1) % this.chunks.length;
            robot.x = to.id === rightNeighbor ? from.x1 - edge : from.x0 + edge;
            robot.blocked = true;
            if (isPlayer && robot.ownerConnectionId !== null && now >= robot.blockedNotifyAt) {
              robot.blockedNotifyAt = now + 1500;
              notices.push({ connId: robot.ownerConnectionId, section: to.id });
            }
            continue;
          }
        }
        // Admitted: there was room, or a player has waited out its bounded queue.
        robot.blocked = false;
        robot.queuedSince = 0;
        incoming.set(to.id, approved + 1);
        moves.push({ from, to, robot });
      }
    }
    for (const { from, to, robot } of moves) {
      from.removeOccupant(robot.id);
      to.addOccupant(robot);
    }
    return notices;
  }
}
