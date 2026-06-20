import { EntityKind, type EntitySnapshot, PieceStatus } from '@rms/shared';

/**
 * One build piece in the contract's blueprint (§3, §6). A static entity: it never
 * moves, only advances its status through the assembly state machine.
 *
 * A normal piece goes Ghost → Placed on a single delivery. A weld piece (§10)
 * needs two robots: a holder (who brought the beam, stays carrying) takes it
 * Ghost → Reserved, then a welder joins for Reserved → InProgress, and after the
 * weld duration both present → Placed. Any drop or TTL releases it to Ghost.
 */
export class Piece {
  readonly id: number;
  /** Stable, permanent identity (§4.6). */
  readonly stableId: string;
  readonly x: number;
  readonly y: number;
  /** A two-robot weld piece (vs. a single-robot piece). */
  readonly weld: boolean;
  status: PieceStatus = PieceStatus.Ghost;
  // Weld bookkeeping (only meaningful while weld && status is Reserved/InProgress).
  holderId: number | null = null;
  welderId: number | null = null;
  /** Reserved-state TTL: release if no welder by this time (§10). */
  reserveDeadline = 0;
  /** InProgress: the weld finishes at this time if both stay engaged. */
  weldDoneAt: number | null = null;

  constructor(id: number, stableId: string, x: number, y: number, weld = false) {
    this.id = id;
    this.stableId = stableId;
    this.x = x;
    this.y = y;
    this.weld = weld;
  }

  /** Back to an unbuilt ghost, clearing any weld engagement. */
  reset(): void {
    this.status = PieceStatus.Ghost;
    this.holderId = null;
    this.welderId = null;
    this.weldDoneAt = null;
  }

  toSnapshot(): EntitySnapshot {
    return {
      id: this.id,
      kind: this.weld ? EntityKind.WeldPiece : EntityKind.Piece,
      x: this.x,
      y: this.y,
      status: this.status,
    };
  }
}
