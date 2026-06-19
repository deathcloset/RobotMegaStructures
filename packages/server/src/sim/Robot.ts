import { EntityKind, type EntitySnapshot, RobotStatus } from '@rms/shared';
import { advanceToward } from './movement';

export class Robot {
  readonly id: number;
  /** Stable, permanent identity (§4.6). The wire uses the compact int `id`. */
  readonly stableId: string;
  x: number;
  y: number;
  targetX: number;
  targetY: number;
  status: RobotStatus = RobotStatus.Idle;
  /** Connection that controls this robot, or null for a server-seeded NPC. */
  readonly ownerConnectionId: number | null;

  constructor(
    id: number,
    stableId: string,
    x: number,
    y: number,
    ownerConnectionId: number | null,
  ) {
    this.id = id;
    this.stableId = stableId;
    this.x = x;
    this.y = y;
    this.targetX = x;
    this.targetY = y;
    this.ownerConnectionId = ownerConnectionId;
  }

  setTarget(x: number, y: number): void {
    this.targetX = x;
    this.targetY = y;
  }

  step(dt: number): void {
    const r = advanceToward(this, { x: this.targetX, y: this.targetY }, dt);
    this.x = r.x;
    this.y = r.y;
    this.status = r.arrived ? RobotStatus.Idle : RobotStatus.Moving;
  }

  toSnapshot(): EntitySnapshot {
    return { id: this.id, kind: EntityKind.Robot, x: this.x, y: this.y, status: this.status };
  }
}
