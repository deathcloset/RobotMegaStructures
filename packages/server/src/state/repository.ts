import type { Chunk } from '../sim/Chunk';

/**
 * The persistence seam (§4.6). Phase 0 ships only the in-memory implementation.
 * Phase 2 adds a ValkeyWorldRepo (hot chunk state + cross-server pub/sub) and
 * Phase 3 a Postgres identity repo behind this same interface — nothing in the
 * sim changes. We deliberately do NOT add DB clients now: an interface with no
 * consumer encodes wrong guesses (§2.5/§4.6). The consumer here is the sim,
 * today.
 */
export interface WorldRepo {
  /** Mint the next stable, permanent entity id (§4.6 — stable IDs from day one). */
  nextStableId(prefix: string): string;
  /** Snapshot in-flight chunk state durably (no-op in memory). */
  saveChunkSnapshot(chunk: Chunk): void;
}

export class InMemoryWorldRepo implements WorldRepo {
  private counter = 0;

  nextStableId(prefix: string): string {
    this.counter += 1;
    return `${prefix}_${this.counter.toString(36)}`;
  }

  saveChunkSnapshot(_chunk: Chunk): void {
    // no-op: Phase 0 keeps everything in process memory (§9).
  }
}
