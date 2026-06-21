import { CHUNK_COLS, chunkColOf, SECTION_WIDTH, wrapDeltaX } from '@rms/shared';
import { Chunk } from './Chunk';
import type { Robot } from './Robot';

/**
 * The chunk grid (§4.3): the planet's circumference tiled by `CHUNK_COLS` sections,
 * each a self-contained worksite. This registry is the one indirection between
 * "one chunk" and "many" — and, later, between "many chunks in one process" and
 * "chunks spread across sim servers" (§4.5). The sim loop, gateway, and broadcast
 * all go through it instead of reaching for a single chunk.
 */
export class ChunkRegistry {
  private readonly chunks: Chunk[] = [];

  constructor() {
    for (let c = 0; c < CHUNK_COLS; c++) this.chunks.push(new Chunk(c));
  }

  get(id: number): Chunk | undefined {
    return this.chunks[id];
  }

  /** The section new players spawn into (and a convenient default). */
  get primary(): Chunk {
    return this.chunks[0]!;
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

  /** Remove a robot wherever it lives (grace expiry / disconnect). */
  removeRobot(robotId: number): void {
    this.chunkOfRobot(robotId)?.removeOccupant(robotId);
  }

  /**
   * Move any robot that has walked out of its section into the one that now owns
   * its position — the in-process form of the cross-section handoff (§4.4). The
   * OSHA cap (refusing entry to a full section) and the checkpoint feel are the
   * next slice; this is just membership-by-position so interest management stays
   * correct as robots roam the planet.
   */
  settle(): void {
    const moves: Array<{ from: Chunk; to: Chunk; robot: Robot }> = [];
    for (const from of this.chunks) {
      for (const robot of from.occupants()) {
        if (!from.contains(robot.x)) {
          const to = this.chunkAt(robot.x);
          if (to !== from) moves.push({ from, to, robot });
        }
      }
    }
    for (const { from, to, robot } of moves) {
      from.removeOccupant(robot.id);
      to.addOccupant(robot);
    }
  }
}
