import { EntityKind, type EntitySnapshot, ROBOT_SPEED, RobotStatusBit } from '@rms/shared';
import { advanceToward } from './movement';

/** What a robot will do when it reaches its current target (§3 build loop). The
 *  Chunk sets this from an interact intent and resolves it on arrival. */
export type PendingAction =
  | { kind: 'pickup'; targetId: number }
  | { kind: 'deliver'; targetId: number }
  | { kind: 'weld'; targetId: number }
  | { kind: 'mine'; targetId: number };

export class Robot {
  readonly id: number;
  /** Stable, permanent identity (§4.6). The wire uses the compact int `id`. */
  readonly stableId: string;
  /** Server-seeded ambient robot (wanders) vs a player robot (controlled). */
  readonly isNpc: boolean;
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
  /** An NPC that autonomously runs the build loop (vs. one that just wanders).
   *  The seed of the future commandable AI crew / swarm. */
  isBuilder = false;
  /** A builder that prospects the planet's ore veins for material instead of using
   *  the convenient depots (it falls back to a depot if no vein is available). The
   *  seed of distinct robot roles for the crews/swarms slice. */
  prefersMining = false;
  /** Builder AI: earliest time it'll pick its next action — a deliberate dawdle
   *  so AI bots are visibly less efficient than players. */
  nextActionAt = 0;
  /** Roaming work crews (§4.4 traffic): the section this builder is travelling to
   *  (null = working locally), when it'll next consider relocating, and whether it
   *  may roam at all (seeded builders do; test/ad-hoc builders don't). */
  migratingTo: number | null = null;
  relocateAt = 0;
  canMigrate = false;
  /** Weld piece this robot is currently holding/welding (§10). While engaged it
   *  holds position and isn't reassigned; the Chunk's weld logic frees it. */
  engagedPieceId: number | null = null;
  /** When the current dig of an ore vein finishes (§ Phase 2 mining); null when
   *  not mining. The robot holds at the vein until then. */
  mineUntil: number | null = null;
  /** Held at a section checkpoint because the next section is at its OSHA cap
   *  (§4.4). Transient, set by the registry's handoff each tick. */
  blocked = false;
  /** Throttle for the "section full" nudge to the owning player while blocked. */
  blockedNotifyAt = 0;
  /** Movement speed (world units/sec). Builders run a little slower than players. */
  speed = ROBOT_SPEED;
  /** Connection controlling this robot. Null for an NPC, or for a player robot
   *  whose owner has dropped and is in the §4.7 grace window ("parked"). */
  ownerConnectionId: number | null;

  constructor(
    id: number,
    stableId: string,
    x: number,
    y: number,
    isNpc: boolean,
    ownerConnectionId: number | null = null,
  ) {
    this.id = id;
    this.stableId = stableId;
    this.isNpc = isNpc;
    this.x = x;
    this.y = y;
    this.targetX = x;
    this.targetY = y;
    this.ownerConnectionId = ownerConnectionId;
  }

  /** A live player at the controls (not an NPC, not parked mid-grace). */
  get controlled(): boolean {
    return !this.isNpc && this.ownerConnectionId !== null;
  }

  /** A player robot whose owner dropped — parked, reclaimable on reconnect (§4.7). */
  get parked(): boolean {
    return !this.isNpc && this.ownerConnectionId === null;
  }

  setTarget(x: number, y: number): void {
    this.targetX = x;
    this.targetY = y;
  }

  /** Park where it stands — used after a pending action, or on owner dropout. */
  halt(): void {
    this.targetX = this.x;
    this.targetY = this.y;
    this.moving = false;
  }

  /** `wrapWidth` (the world circumference) makes movement honour the cylinder
   *  seam; 0 keeps the flat-plane behaviour (used by the movement unit tests). */
  step(dt: number, wrapWidth = 0): void {
    const r = advanceToward(this, { x: this.targetX, y: this.targetY }, dt, this.speed, wrapWidth);
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
