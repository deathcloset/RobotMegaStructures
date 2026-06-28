import {
  type ClientMessage,
  DEFAULT_CONTRACT_RESET_MS,
  DomainEvent,
  type EntitySnapshot,
  GROUND_Y,
  INTERACT_RANGE,
  MessageType,
  MINE_DURATION_MS,
  PieceStatus,
  SECTION_WIDTH,
  WELD_DURATION_MS,
  WELD_RESERVATION_TTL_MS,
  WORLD_HEIGHT,
  WORLD_WIDTH,
  wrappedDistance,
  wrapX,
} from '@rms/shared';
import type { Deposit } from './Deposit';
import { Flag } from './Flag';
import type { Piece } from './Piece';
import type { Resource } from './Resource';
import type { Robot } from './Robot';

/** Work-flag ids are derived from the owner's robot id (one flag per player) and
 *  kept disjoint from the seeded-entity ranges in `blueprint.ts`. */
const FLAG_ID_BASE = 4_000_000;

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
  /** Section (column) index in the planet's chunk grid; also this chunk's id. */
  readonly id: number;
  /** The world-X slice this section owns, [x0, x1) — used by the registry to route
   *  intents and gather per-viewport interest; the sim itself works in world
   *  coords with a global wrap. */
  readonly x0: number;
  readonly x1: number;
  /** X of this section's centre (where its worksite is seeded / framed). */
  readonly centerX: number;
  /** Planet circumference (the wrap width). Movement/distance/AOI measure X the
   *  short way around THIS, not the section width. Height is bounded; groundY is
   *  the surface. */
  readonly width = WORLD_WIDTH;
  readonly height = WORLD_HEIGHT;
  readonly groundY = GROUND_Y;
  /** OSHA cap: max robots in this section before the checkpoint queues (§4.4). */
  readonly capacity: number;
  private readonly robots = new Map<number, Robot>();
  private readonly pieces = new Map<number, Piece>();
  private readonly resources = new Map<number, Resource>();
  private readonly deposits = new Map<number, Deposit>();
  /** Player work-flags, keyed by flag id (one per player; § Phase 2 crews). */
  private readonly flags = new Map<number, Flag>();
  private readonly events: ChunkEvent[] = [];
  private placed = 0;
  private completed = false;
  /** When the contract finished — the reset countdown anchor (null until done). */
  private completedAt: number | null = null;

  constructor(col = 0, capacity = Number.POSITIVE_INFINITY) {
    this.id = col;
    this.x0 = col * SECTION_WIDTH;
    this.x1 = this.x0 + SECTION_WIDTH;
    this.centerX = this.x0 + SECTION_WIDTH / 2;
    this.capacity = capacity;
  }

  /** At or above the OSHA cap — the checkpoint queues new arrivals (§4.4). */
  get isFull(): boolean {
    return this.robots.size >= this.capacity;
  }

  /** True if a world-X belongs to this section (wrap-normalized). */
  contains(x: number): boolean {
    const wx = wrapX(x, this.width);
    return wx >= this.x0 && wx < this.x1;
  }

  addOccupant(robot: Robot): void {
    this.robots.set(robot.id, robot);
    this.events.push({ name: DomainEvent.RobotEnteredChunk, payload: { robotId: robot.id } });
  }

  removeOccupant(robotId: number): void {
    if (this.robots.delete(robotId)) {
      this.clearFlag(robotId); // a departed player's work-flag goes with them
      // Any weld this robot was part of self-heals in advanceWelds (it'll see the
      // participant missing next tick and release/demote the piece).
      this.events.push({ name: DomainEvent.RobotLeftChunk, payload: { robotId } });
    }
  }

  /** Plant or move a player's single work-flag (on the surface). § Phase 2 crews. */
  private placeFlag(robotId: number, x: number): void {
    const id = FLAG_ID_BASE + robotId;
    const y = this.groundY - 8; // flags sit on the surface
    const existing = this.flags.get(id);
    if (existing) {
      existing.x = x;
      existing.y = y;
    } else {
      this.flags.set(id, new Flag(id, robotId, x, y));
    }
  }

  private clearFlag(robotId: number): void {
    this.flags.delete(FLAG_ID_BASE + robotId);
  }

  /** Nearest work-flag to a point (the crew rallies to whichever flag is closest). */
  private nearestFlag(x: number, y: number): Flag | null {
    let best: Flag | null = null;
    let bestDist = Number.POSITIVE_INFINITY;
    for (const flag of this.flags.values()) {
      const d = wrappedDistance(x, y, flag.x, flag.y, this.width);
      if (d < bestDist) {
        bestDist = d;
        best = flag;
      }
    }
    return best;
  }

  /** Seed a blueprint piece (ghost). Static for the contract's lifetime. */
  addPiece(piece: Piece): void {
    this.pieces.set(piece.id, piece);
  }

  /** Seed a resource depot. */
  addResource(resource: Resource): void {
    this.resources.set(resource.id, resource);
  }

  /** Seed an ore deposit (surface mining, § Phase 2). */
  addDeposit(deposit: Deposit): void {
    this.deposits.set(deposit.id, deposit);
  }

  getRobot(robotId: number): Robot | undefined {
    return this.robots.get(robotId);
  }

  /** Read-only view of this section's robots (for the registry's handoff upkeep). */
  occupants(): IterableIterator<Robot> {
    return this.robots.values();
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
      // A manual move redirects the robot, cancels any queued action, and lets go
      // of any weld it was holding/welding or vein it was digging.
      robot.engagedPieceId = null;
      robot.mineUntil = null;
      robot.pendingAction = null;
      // X wraps around the planet; Y is clamped to the surface (sky..ground).
      robot.setTarget(wrapX(msg.tx, this.width), clamp(msg.ty, 0, this.groundY));
    } else if (msg.t === MessageType.C_INTENT_INTERACT) {
      robot.engagedPieceId = null; // a new command releases any current weld hold
      robot.mineUntil = null; // ...or abandons a dig in progress
      this.applyInteract(robot, msg.targetId);
    } else if (msg.t === MessageType.C_INTENT_FLAG) {
      // Plant or move this player's work-flag, kept within this section so it stays
      // owned by the chunk it's in (and rallies this section's crew).
      this.placeFlag(robot.id, clamp(wrapX(msg.tx, this.width), this.x0, this.x1 - 1));
    }
  }

  /** Queue a context-appropriate action. The server decides — the client can't
   *  lie: empty robots grab a depot or weld a piece awaiting a partner; loaded
   *  robots deliver to a ghost (placing it, or holding a weld piece). */
  private applyInteract(robot: Robot, targetId: number): void {
    // Tapping your own work-flag picks it up (someone else's is a no-op).
    const flag = this.flags.get(targetId);
    if (flag) {
      if (flag.ownerRobotId === robot.id) this.clearFlag(robot.id);
      return;
    }
    if (!robot.carrying) {
      const res = this.resources.get(targetId);
      if (res) {
        robot.setTarget(res.x, res.y);
        robot.pendingAction = { kind: 'pickup', targetId };
        return;
      }
      const dep = this.deposits.get(targetId);
      if (dep && dep.amount >= 1) {
        robot.setTarget(dep.x, dep.y);
        robot.pendingAction = { kind: 'mine', targetId };
        return;
      }
      const weld = this.pieces.get(targetId);
      if (weld?.weld && weld.status === PieceStatus.Reserved && weld.holderId !== robot.id) {
        robot.setTarget(weld.x, weld.y);
        robot.pendingAction = { kind: 'weld', targetId };
      }
      return;
    }
    const piece = this.pieces.get(targetId);
    if (!piece) return;
    if (piece.status === PieceStatus.Ghost) {
      // deliver: a normal piece gets placed; a weld piece gets held (Reserved).
      robot.setTarget(piece.x, piece.y);
      robot.pendingAction = { kind: 'deliver', targetId };
    } else if (piece.weld && piece.status === PieceStatus.Reserved && piece.holderId !== robot.id) {
      // a carrying robot can also be the welder for someone else's hold
      robot.setTarget(piece.x, piece.y);
      robot.pendingAction = { kind: 'weld', targetId };
    }
  }

  /** Advance the simulation one tick. Robots engaged in a weld hold still;
   *  controlled players and builder NPCs resolve queued actions (builders also
   *  pick the next one); plain NPCs wander; parked robots hold (§4.7). `now`
   *  drives the weld, reservation-TTL, builder-dawdle, and contract-reset clocks. */
  step(dt: number, now: number): void {
    for (const robot of this.robots.values()) {
      if (robot.engagedPieceId !== null) {
        robot.halt(); // holding/welding — the weld logic frees it
        continue;
      }
      robot.step(dt, this.width);
      if (robot.isNpc) {
        if (robot.isBuilder) this.driveBuilder(robot, now);
        // Wanderers roam the WHOLE planet (across sections), so bots flow through
        // checkpoints and queue at busy ones — the section caps come alive (§4.4).
        else if (!robot.moving) robot.setTarget(Math.random() * this.width, this.wanderY());
      } else if (robot.controlled) {
        this.resolvePending(robot, now);
      }
    }
    this.advanceWelds(now);
    for (const dep of this.deposits.values()) dep.regen(dt); // veins slowly refill
    this.advanceContract(now);
  }

  /** Autonomous build loop for an AI bot, including weld cooperation: weld a piece
   *  awaiting a partner if there's one (no material needed), else haul from the
   *  nearest depot to the nearest ghost. A short dawdle keeps bots visibly less
   *  efficient than players. The seed of the commandable crew/swarm. */
  private driveBuilder(robot: Robot, now: number): void {
    if (robot.pendingAction !== null) {
      this.resolvePending(robot, now);
      // Finished (and not now holding/welding) → dawdle before the next action.
      if (robot.pendingAction === null && robot.engagedPieceId === null) {
        robot.nextActionAt = now + 400 + Math.random() * 1400;
      }
      return;
    }
    if (now < robot.nextActionAt) return;

    const weldNeedingPartner = this.nearestReservedWeld(robot.x, robot.y, robot.id);
    if (weldNeedingPartner) {
      robot.setTarget(weldNeedingPartner.x, weldNeedingPartner.y);
      robot.pendingAction = { kind: 'weld', targetId: weldNeedingPartner.id };
      return;
    }
    if (!robot.carrying) {
      // A work-flag rallies the whole crew: mine the nearest vein to the flag,
      // hauling back to the structure — the commandable-crew lever (§ Phase 2).
      const flag = this.nearestFlag(robot.x, robot.y);
      if (flag) {
        const flagged = this.nearestDeposit(flag.x, flag.y);
        if (flagged) {
          robot.setTarget(flagged.x, flagged.y);
          robot.pendingAction = { kind: 'mine', targetId: flagged.id };
          return;
        }
      }
      // No flag (or no vein near it): prospectors mine, other builders use the
      // convenient depots — each falls back to the other so none is stuck empty.
      const vein = this.nearestDeposit(robot.x, robot.y);
      const depot = this.nearestResource(robot.x, robot.y);
      const mine = robot.prefersMining ? vein : null;
      if (mine) {
        robot.setTarget(mine.x, mine.y);
        robot.pendingAction = { kind: 'mine', targetId: mine.id };
      } else if (depot) {
        robot.setTarget(depot.x, depot.y);
        robot.pendingAction = { kind: 'pickup', targetId: depot.id };
      } else if (vein) {
        robot.setTarget(vein.x, vein.y);
        robot.pendingAction = { kind: 'mine', targetId: vein.id };
      }
    } else {
      const ghost = this.nearestGhost(robot.x, robot.y);
      if (ghost) {
        robot.setTarget(ghost.x, ghost.y);
        robot.pendingAction = { kind: 'deliver', targetId: ghost.id };
      } else {
        robot.nextActionAt = now + 1000; // nothing to build (resetting) — wait
      }
    }
  }

  /** Execute a robot's queued action once it's within interaction range. */
  private resolvePending(robot: Robot, now: number): void {
    const action = robot.pendingAction;
    if (action === null) return;

    if (action.kind === 'pickup') {
      const res = this.resources.get(action.targetId);
      if (!res) {
        robot.pendingAction = null;
        return;
      }
      if (!within(robot, res, this.width)) return;
      if (!robot.carrying) {
        robot.carrying = true;
        this.events.push({
          name: DomainEvent.ResourcePickedUp,
          payload: { robotId: robot.id, resourceId: res.id },
        });
      }
    } else if (action.kind === 'deliver') {
      const piece = this.pieces.get(action.targetId);
      if (!piece) {
        robot.pendingAction = null;
        return;
      }
      if (!within(robot, piece, this.width)) return;
      if (robot.carrying && piece.status === PieceStatus.Ghost) {
        if (piece.weld) {
          // Hold the beam in place; await a welder (§10). Keep carrying.
          piece.status = PieceStatus.Reserved;
          piece.holderId = robot.id;
          piece.reserveDeadline = now + WELD_RESERVATION_TTL_MS;
          robot.engagedPieceId = piece.id;
          this.events.push({ name: DomainEvent.PieceReserved, payload: { pieceId: piece.id } });
        } else {
          this.placePiece(piece, robot);
        }
      }
    } else if (action.kind === 'weld') {
      // join someone's held piece as the welder.
      const piece = this.pieces.get(action.targetId);
      if (!piece) {
        robot.pendingAction = null;
        return;
      }
      if (!within(robot, piece, this.width)) return;
      if (
        piece.weld &&
        piece.status === PieceStatus.Reserved &&
        piece.welderId === null &&
        piece.holderId !== robot.id
      ) {
        piece.welderId = robot.id;
        piece.status = PieceStatus.InProgress;
        piece.weldDoneAt = now + WELD_DURATION_MS;
        robot.engagedPieceId = piece.id;
      }
    } else {
      // 'mine': dig an ore vein for a while, then carry off a load (§ Phase 2).
      const dep = this.deposits.get(action.targetId);
      if (!dep) {
        robot.mineUntil = null;
        robot.pendingAction = null;
        return;
      }
      if (!within(robot, dep, this.width)) return; // still walking to the vein
      if (robot.mineUntil === null) {
        robot.mineUntil = now + MINE_DURATION_MS; // arrived → start digging
        robot.halt();
        return;
      }
      if (now < robot.mineUntil) return; // still digging — hold at the vein
      robot.mineUntil = null;
      if (!robot.carrying && dep.extract()) {
        robot.carrying = true;
        this.events.push({
          name: DomainEvent.ResourcePickedUp,
          payload: { robotId: robot.id, depositId: dep.id },
        });
      }
    }
    robot.halt();
    robot.pendingAction = null;
  }

  /** Tick the two-robot weld state machine: complete welds whose timer elapsed
   *  with both robots still engaged, and release/demote on a missing partner or
   *  an expired reservation TTL — so a dropped partner never deadlocks (§4.7/§10). */
  private advanceWelds(now: number): void {
    for (const piece of this.pieces.values()) {
      if (!piece.weld) continue;
      if (piece.status === PieceStatus.Reserved) {
        const holder = this.engaged(piece.holderId, piece.id);
        if (!holder || !holder.carrying || now > piece.reserveDeadline) {
          this.releaseWeld(piece);
        }
      } else if (piece.status === PieceStatus.InProgress) {
        const holder = this.engaged(piece.holderId, piece.id);
        const welder = this.engaged(piece.welderId, piece.id);
        if (!holder || !holder.carrying) {
          this.releaseWeld(piece); // the beam's gone — drop it back to a ghost
        } else if (!welder) {
          // welder wandered off / dropped — back to awaiting a partner
          piece.welderId = null;
          piece.status = PieceStatus.Reserved;
          piece.weldDoneAt = null;
          piece.reserveDeadline = now + WELD_RESERVATION_TTL_MS;
        } else if (piece.weldDoneAt !== null && now >= piece.weldDoneAt) {
          this.completeWeld(piece);
        }
      }
    }
  }

  /** Return the robot iff it exists and is still engaged on this exact piece. */
  private engaged(robotId: number | null, pieceId: number): Robot | undefined {
    if (robotId === null) return undefined;
    const robot = this.robots.get(robotId);
    return robot && robot.engagedPieceId === pieceId ? robot : undefined;
  }

  private releaseWeld(piece: Piece): void {
    const holder = piece.holderId !== null ? this.robots.get(piece.holderId) : undefined;
    const welder = piece.welderId !== null ? this.robots.get(piece.welderId) : undefined;
    if (holder) holder.engagedPieceId = null; // keeps carrying its beam
    if (welder) welder.engagedPieceId = null;
    piece.reset();
    this.events.push({ name: DomainEvent.PieceReleased, payload: { pieceId: piece.id } });
  }

  private completeWeld(piece: Piece): void {
    const holder = piece.holderId !== null ? this.robots.get(piece.holderId) : undefined;
    const welder = piece.welderId !== null ? this.robots.get(piece.welderId) : undefined;
    if (holder) {
      holder.carrying = false;
      holder.engagedPieceId = null;
    }
    if (welder) welder.engagedPieceId = null;
    piece.status = PieceStatus.Placed;
    piece.holderId = null;
    piece.welderId = null;
    piece.weldDoneAt = null;
    this.recordPlacement(piece.id);
  }

  private placePiece(piece: Piece, robot: Robot): void {
    piece.status = PieceStatus.Placed;
    robot.carrying = false;
    this.recordPlacement(piece.id);
  }

  private recordPlacement(pieceId: number): void {
    this.placed += 1;
    this.events.push({
      name: DomainEvent.PiecePlaced,
      payload: { pieceId, placed: this.placed, total: this.pieces.size },
    });
    this.checkContractComplete();
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
      for (const piece of this.pieces.values()) piece.reset();
      this.placed = 0;
      this.completed = false;
      this.completedAt = null;
      this.events.push({ name: DomainEvent.ContractStarted, payload: { total: this.pieces.size } });
    }
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

  /** A random Y in the band just above the surface — ambient wanderers mill along
   *  the ground rather than floating up into the empty sky. */
  private wanderY(): number {
    return this.groundY - Math.random() * 220;
  }

  private nearestResource(x: number, y: number): Resource | null {
    let best: Resource | null = null;
    let bestDist = Number.POSITIVE_INFINITY;
    for (const res of this.resources.values()) {
      const d = wrappedDistance(x, y, res.x, res.y, this.width);
      if (d < bestDist) {
        bestDist = d;
        best = res;
      }
    }
    return best;
  }

  /** Nearest ore vein that still has material (for the mining builders). */
  private nearestDeposit(x: number, y: number): Deposit | null {
    let best: Deposit | null = null;
    let bestDist = Number.POSITIVE_INFINITY;
    for (const dep of this.deposits.values()) {
      if (dep.amount < 1) continue;
      const d = wrappedDistance(x, y, dep.x, dep.y, this.width);
      if (d < bestDist) {
        bestDist = d;
        best = dep;
      }
    }
    return best;
  }

  private nearestGhost(x: number, y: number): Piece | null {
    let best: Piece | null = null;
    let bestDist = Number.POSITIVE_INFINITY;
    for (const piece of this.pieces.values()) {
      if (piece.status !== PieceStatus.Ghost) continue;
      const d = wrappedDistance(x, y, piece.x, piece.y, this.width);
      if (d < bestDist) {
        bestDist = d;
        best = piece;
      }
    }
    return best;
  }

  /** Nearest weld piece that has a holder but no welder yet (a partner is needed),
   *  excluding one held by `excludeRobotId` (you can't weld your own hold). */
  private nearestReservedWeld(x: number, y: number, excludeRobotId: number): Piece | null {
    let best: Piece | null = null;
    let bestDist = Number.POSITIVE_INFINITY;
    for (const piece of this.pieces.values()) {
      if (!piece.weld || piece.status !== PieceStatus.Reserved) continue;
      if (piece.welderId !== null || piece.holderId === excludeRobotId) continue;
      const d = wrappedDistance(x, y, piece.x, piece.y, this.width);
      if (d < bestDist) {
        bestDist = d;
        best = piece;
      }
    }
    return best;
  }

  /** Read-only projection of all entities (Phase 0 AOI = whole chunk). */
  fullSnapshot(): EntitySnapshot[] {
    const out: EntitySnapshot[] = [];
    for (const robot of this.robots.values()) out.push(robot.toSnapshot());
    for (const piece of this.pieces.values()) out.push(piece.toSnapshot());
    for (const resource of this.resources.values()) out.push(resource.toSnapshot());
    for (const deposit of this.deposits.values()) out.push(deposit.toSnapshot());
    for (const flag of this.flags.values()) out.push(flag.toSnapshot());
    return out;
  }

  /** Drain domain events emitted since the last call (§6 first-class stream). */
  drainEvents(): ChunkEvent[] {
    if (this.events.length === 0) return [];
    return this.events.splice(0, this.events.length);
  }
}

function within(robot: Robot, e: { x: number; y: number }, width: number): boolean {
  return wrappedDistance(robot.x, robot.y, e.x, e.y, width) <= INTERACT_RANGE;
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
