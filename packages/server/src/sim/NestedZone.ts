import type { SectionInfo } from '@rms/shared';

/**
 * A nested zone (§4.4): a capped interior chamber that sits WITHIN a parent section
 * rather than tiling the ring — "a part of the structure in the middle of other
 * parts." It floats above the surface, so ground-traversers pass underneath it and
 * entry is opt-in (tap the gate), never forced by walking past. Mechanically it is
 * *just another zone with a cap*: it carries a capacity + live occupancy and rides
 * the same `S_SECTIONS` label list. The cap is HARD for everyone — even players —
 * unlike the ring checkpoints, which never wall a traverser; because entering is a
 * choice here, a real limit is fair (you queue at the gate, or walk away).
 *
 * It's owned by its parent `Chunk` (so it shards with the parent when sections later
 * live on different servers) and holds no robots of its own: occupants stay in the
 * parent chunk's robot set — still simulated + snapshotted — just flagged
 * `insideZone` and repositioned up in the chamber. This Set is the membership ledger.
 */
export class NestedZone {
  /** Robot ids currently inside; kept in sync by the Chunk on enter/leave/handoff. */
  readonly occupants = new Set<number>();
  /** When this chamber's interior contract should reset to fresh ghosts after being
   *  finished (null = not currently complete) — the vault loops on its own, faster than
   *  the section, so there's always work inside and a player always gets a window. */
  rebuildAt: number | null = null;

  constructor(
    /** Zone id — disjoint from ring section ids (which are 0..CHUNK_COLS-1). */
    readonly id: number,
    /** The ring section this chamber lives inside. */
    readonly parentSection: number,
    /** Max occupants (a hard cap). */
    readonly cap: number,
    /** Chamber centre — the label anchor and where occupants gather (world coords). */
    readonly x: number,
    readonly y: number,
    /** The gate entity: the tappable entrance, standing on the surface below. */
    readonly gateId: number,
    readonly gateX: number,
    readonly gateY: number,
  ) {}

  get count(): number {
    return this.occupants.size;
  }

  get isFull(): boolean {
    return this.occupants.size >= this.cap;
  }

  /** This zone as a label entry for the client (a `nested` row in S_SECTIONS). */
  toSectionInfo(): SectionInfo {
    return { id: this.id, cap: this.cap, count: this.count, x: this.x, y: this.y, nested: true };
  }
}
