import { EntityKind, type EntitySnapshot } from '@rms/shared';

/**
 * A player's work-flag (§ Phase 2 crews). Planted on the surface to rally the
 * builder crew to work the area around it (they mine the nearest vein to the
 * flag). One per player; moving it re-aims the crew, tapping it picks it up. The
 * wire carries the owner's robot id as `status` so a client can tell its own flag
 * from others'.
 */
export class Flag {
  readonly id: number;
  readonly ownerRobotId: number;
  x: number;
  y: number;

  constructor(id: number, ownerRobotId: number, x: number, y: number) {
    this.id = id;
    this.ownerRobotId = ownerRobotId;
    this.x = x;
    this.y = y;
  }

  toSnapshot(): EntitySnapshot {
    return { id: this.id, kind: EntityKind.Flag, x: this.x, y: this.y, status: this.ownerRobotId };
  }
}
