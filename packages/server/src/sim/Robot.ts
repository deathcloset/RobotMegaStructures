import { EntityKind, type EntitySnapshot, RobotStatusBit } from '@rms/shared';
import { advanceToward } from './movement';

/** What a robot will do when it reaches its current target (§3 build loop). The
 *  Chunk sets this from an interact intent and resolves it on arrival. */
export type PendingAction =
  | { kind: 'pickup'; targetId: number }
  | { kind: 'deliver'; targetId: number };

export class Robot {
  readonly id: number;
  /** Stable, permanent identity (§4.6). The wire uses the compact int `id`. */
  readonly stableId: string;
  x: number;
  y: number;
  targetX: number;
  targetY: number;
  /** In transit this tick (drives the Moving status bit). */
  moving = false;
  /** Hauling a resource toward a ghost piece (drives the Carrying status bit). */
  carrying = false;
  /** Queued build-loop action, resolved by the Chunk on arrival. */
  pendingAction: PendingAction | null = null;
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

  /** Park where it stands — used after completing a pending action. */
  halt(): void {
    this.targetX = this.x;
    this.targetY = this.y;
    this.moving = false;
  }

  step(dt: number): void {
    const r = advanceToward(this, { x: this.targetX, y: this.targetY }, dt);
    this.x = r.x;
    this.y = r.y;
    this.moving = !r.arrived;
  }

  toSnapshot(): EntitySnapshot {
    const status =
      (this.moving ? RobotStatusBit.Moving : 0) | (this.carrying ? RobotStatusBit.Carrying : 0);
    return { id: this.id, kind: EntityKind.Robot, x: this.x, y: this.y, status };
  }
}
