import {
  CHUNK_ID,
  type ClientMessage,
  DomainEvent,
  type EntitySnapshot,
  MessageType,
  RobotStatus,
  WORLD_SIZE,
} from '@rms/shared';
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
  private readonly events: ChunkEvent[] = [];

  addOccupant(robot: Robot): void {
    this.robots.set(robot.id, robot);
    this.events.push({ name: DomainEvent.RobotEnteredChunk, payload: { robotId: robot.id } });
  }

  removeOccupant(robotId: number): void {
    if (this.robots.delete(robotId)) {
      this.events.push({ name: DomainEvent.RobotLeftChunk, payload: { robotId } });
    }
  }

  getRobot(robotId: number): Robot | undefined {
    return this.robots.get(robotId);
  }

  get occupantCount(): number {
    return this.robots.size;
  }

  /** The single mutation entry point. Never trusts the client. */
  applyIntent(robotId: number, msg: ClientMessage): void {
    if (msg.t !== MessageType.C_INTENT_MOVE) return;
    const robot = this.robots.get(robotId);
    if (!robot) return;
    robot.setTarget(clamp(msg.tx, 0, this.size), clamp(msg.ty, 0, this.size));
  }

  /** Advance the simulation one tick. NPCs (no owner) wander on arrival. */
  step(dt: number): void {
    for (const robot of this.robots.values()) {
      robot.step(dt);
      if (robot.ownerConnectionId === null && robot.status === RobotStatus.Idle) {
        robot.setTarget(Math.random() * this.size, Math.random() * this.size);
      }
    }
  }

  /** Read-only projection of all entities (Phase 0 AOI = whole chunk). */
  fullSnapshot(): EntitySnapshot[] {
    const out: EntitySnapshot[] = [];
    for (const robot of this.robots.values()) out.push(robot.toSnapshot());
    return out;
  }

  /** Drain domain events emitted since the last call (§6 first-class stream). */
  drainEvents(): ChunkEvent[] {
    if (this.events.length === 0) return [];
    return this.events.splice(0, this.events.length);
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
