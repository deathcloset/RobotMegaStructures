import {
  CHUNK_ID,
  type ClientMessage,
  DEFAULT_CONTRACT_RESET_MS,
  DomainEvent,
  type EntitySnapshot,
  INTERACT_RANGE,
  MessageType,
  PieceStatus,
  WORLD_SIZE,
} from '@rms/shared';
import type { Piece } from './Piece';
import type { Resource } from './Resource';
import type { Robot } from './Robot';

export interface ChunkEvent {
  name: DomainEvent;
  payload?: unknown;
}

/**
 * One flat square chunk, written as an isolated message-in / state-out unit so a
 * later Elixir/Phoenix port (chunk = process) is mechanical (§4.4, §5.4). No
 * sockets, no timers, no I/O in here: the SimLoop drives time, the gateway owns
 * connections, the Snapshotter reads state. The only mutation entry point is
 * applyIntent — the future "mailbox".
 */
export class Chunk {
  readonly id = CHUNK_ID;
  readonly size = WORLD_SIZE;
  private readonly robots = new Map<number, Robot>();
  private readonly pieces = new Map<number, Piece>();
  private readonly resources = new Map<number, Resource>();
  private readonly events: ChunkEvent[] = [];
  private placed = 0;
  private completed = false;
  /** When the contract finished — the reset countdown anchor (null until done). */
  private completedAt: number | null = null;

  addOccupant(robot: Robot): void {
    this.robots.set(robot.id, robot);
    this.events.push({ name: DomainEvent.RobotEnteredChunk, payload: { robotId: robot.id } });
  }

  removeOccupant(robotId: number): void {
    if (this.robots.delete(robotId)) {
      this.events.push({ name: DomainEvent.RobotLeftChunk, payload: { robotId } });
    }
  }

  /** Seed a blueprint piece (ghost). Static for the contract's lifetime. */
  addPiece(piece: Piece): void {
    this.pieces.set(piece.id, piece);
  }

  /** Seed a resource depot. */
  addResource(resource: Resource): void {
    this.resources.set(resource.id, resource);
  }

  getRobot(robotId: number): Robot | undefined {
    return this.robots.get(robotId);
  }

  get occupantCount(): number {
    return this.robots.size;
  }

  /** Contract progress (§3) — pieces placed of the blueprint total. */
  get pieceCount(): number {
    return this.pieces.size;
  }
  get placedCount(): number {
    return this.placed;
  }
  get isComplete(): boolean {
    return this.completed;
  }

  /** The single mutation entry point. Never trusts the client. */
  applyIntent(robotId: number, msg: ClientMessage): void {
    const robot = this.robots.get(robotId);
    if (!robot) return;
    if (msg.t === MessageType.C_INTENT_MOVE) {
      // A manual move redirects the robot and cancels any queued build action.
      robot.pendingAction = null;
      robot.setTarget(clamp(msg.tx, 0, this.size), clamp(msg.ty, 0, this.size));
    } else if (msg.t === MessageType.C_INTENT_INTERACT) {
      this.applyInteract(robot, msg.targetId);
    }
  }

  /** Queue a context-appropriate action: empty robots grab from a depot, loaded
   *  robots deliver to a ghost piece. The server decides — the client can't lie. */
  private applyInteract(robot: Robot, targetId: number): void {
    if (!robot.carrying) {
      const res = this.resources.get(targetId);
      if (res) {
        robot.setTarget(res.x, res.y);
        robot.pendingAction = { kind: 'pickup', targetId };
      }
      return;
    }
    const piece = this.pieces.get(targetId);
    if (piece && piece.status === PieceStatus.Ghost) {
      robot.setTarget(piece.x, piece.y);
      robot.pendingAction = { kind: 'deliver', targetId };
    }
  }

  /** Advance the simulation one tick. Controlled robots resolve queued build
   *  actions; NPCs wander on arrival; parked (dropped-owner) robots hold still
   *  until reclaimed or removed (§4.7). `now` drives the contract reset clock. */
  step(dt: number, now: number): void {
    for (const robot of this.robots.values()) {
      robot.step(dt);
      if (robot.controlled) {
        this.resolvePending(robot);
      } else if (robot.isNpc && !robot.moving) {
        robot.setTarget(Math.random() * this.size, Math.random() * this.size);
      }
    }
    this.advanceContract(now);
  }

  /** Once a contract completes, hold the celebration briefly, then reset the
   *  blueprint to fresh ghosts so building loops (§2.5 "another contract"). */
  private advanceContract(now: number): void {
    if (!this.completed) return;
    if (this.completedAt === null) {
      this.completedAt = now;
      return;
    }
    if (now - this.completedAt >= DEFAULT_CONTRACT_RESET_MS) {
      for (const piece of this.pieces.values()) piece.status = PieceStatus.Ghost;
      this.placed = 0;
      this.completed = false;
      this.completedAt = null;
      this.events.push({ name: DomainEvent.ContractStarted, payload: { total: this.pieces.size } });
    }
  }

  /** Execute a robot's queued action once it's within interaction range. */
  private resolvePending(robot: Robot): void {
    const action = robot.pendingAction;
    if (action === null) return;

    if (action.kind === 'pickup') {
      const res = this.resources.get(action.targetId);
      if (!res) {
        robot.pendingAction = null;
        return;
      }
      if (!within(robot, res)) return;
      if (!robot.carrying) {
        robot.carrying = true;
        this.events.push({
          name: DomainEvent.ResourcePickedUp,
          payload: { robotId: robot.id, resourceId: res.id },
        });
      }
    } else {
      const piece = this.pieces.get(action.targetId);
      if (!piece) {
        robot.pendingAction = null;
        return;
      }
      if (!within(robot, piece)) return;
      // Re-check at execution time: a piece another robot already placed is a
      // no-op (the robot keeps its load and can deliver elsewhere).
      if (robot.carrying && piece.status === PieceStatus.Ghost) {
        piece.status = PieceStatus.Placed;
        robot.carrying = false;
        this.placed += 1;
        this.events.push({
          name: DomainEvent.PiecePlaced,
          payload: { pieceId: piece.id, placed: this.placed, total: this.pieces.size },
        });
        this.checkContractComplete();
      }
    }
    robot.halt();
    robot.pendingAction = null;
  }

  private checkContractComplete(): void {
    if (!this.completed && this.pieces.size > 0 && this.placed >= this.pieces.size) {
      this.completed = true;
      this.events.push({
        name: DomainEvent.ContractCompleted,
        payload: { placed: this.placed, total: this.pieces.size },
      });
    }
  }

  /** Read-only projection of all entities (Phase 0 AOI = whole chunk). */
  fullSnapshot(): EntitySnapshot[] {
    const out: EntitySnapshot[] = [];
    for (const robot of this.robots.values()) out.push(robot.toSnapshot());
    for (const piece of this.pieces.values()) out.push(piece.toSnapshot());
    for (const resource of this.resources.values()) out.push(resource.toSnapshot());
    return out;
  }

  /** Drain domain events emitted since the last call (§6 first-class stream). */
  drainEvents(): ChunkEvent[] {
    if (this.events.length === 0) return [];
    return this.events.splice(0, this.events.length);
  }
}

function within(robot: Robot, e: { x: number; y: number }): boolean {
  return Math.hypot(robot.x - e.x, robot.y - e.y) <= INTERACT_RANGE;
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
