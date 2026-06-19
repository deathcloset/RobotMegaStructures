import { EntityKind, type EntitySnapshot, PieceStatus } from '@rms/shared';

/**
 * One build piece in the contract's blueprint (§3, §6). A static entity: it never
 * moves, only advances its status through the assembly state machine. Slice 1
 * goes Ghost → Placed on delivery; Reserved/InProgress arrive with the two-robot
 * weld (slice 2, §10).
 */
export class Piece {
  readonly id: number;
  /** Stable, permanent identity (§4.6). */
  readonly stableId: string;
  readonly x: number;
  readonly y: number;
  status: PieceStatus = PieceStatus.Ghost;

  constructor(id: number, stableId: string, x: number, y: number) {
    this.id = id;
    this.stableId = stableId;
    this.x = x;
    this.y = y;
  }

  toSnapshot(): EntitySnapshot {
    return { id: this.id, kind: EntityKind.Piece, x: this.x, y: this.y, status: this.status };
  }
}
