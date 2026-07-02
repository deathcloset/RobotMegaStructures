import {
  CHUNK_COLS,
  type ClientMessage,
  DEFAULT_CONTRACT_RESET_MS,
  DomainEvent,
  EntityKind,
  type EntitySnapshot,
  GROUND_Y,
  INTERACT_RANGE,
  MessageType,
  MINE_DURATION_MS,
  NESTED_ZONE_HALF_W,
  PieceStatus,
  SECTION_WIDTH,
  type SectionInfo,
  WELD_DURATION_MS,
  WELD_RESERVATION_TTL_MS,
  WORLD_HEIGHT,
  WORLD_WIDTH,
  wrappedDistance,
  wrapX,
} from '@rms/shared';
import { driveBuilder, driveCourier } from './crewAi';
import type { Deposit } from './Deposit';
import { Flag } from './Flag';
import type { NestedZone } from './NestedZone';
import type { Piece } from './Piece';
import type { Resource } from './Resource';
import type { Robot } from './Robot';

/** Work-flag ids are derived from the owner's robot id (one flag per player) and
 *  kept disjoint from the seeded-entity ranges in `blueprint.ts`. */
const FLAG_ID_BASE = 4_000_000;

/** Ambient wanderers mill in a band this tall just above the surface, rather than
 *  floating up into the empty sky. */
const WANDER_BAND_H = 220;

/** A nested vault's interior contract loops on its own this long after it's finished
 *  (a brief "done" beat), faster than the section contract — so the chamber stays a
 *  living worksite and a visiting player always finds something to build. */
const VAULT_REBUILD_MS = 8000;

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
  /** Nested zones (§4.4): capped interior chambers within this section. Their
   *  occupants stay in `robots` (still simulated); a zone just tracks membership. */
  private readonly zones: NestedZone[] = [];
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
    const robot = this.robots.get(robotId);
    if (!this.robots.delete(robotId)) return;
    this.clearFlag(robotId); // a departed player's work-flag goes with them
    if (robot) this.leaveZone(robot); // free its nested-zone slot, if any
    // Any weld this robot was part of self-heals in advanceWelds (it'll see the
    // participant missing next tick and release/demote the piece).
    this.events.push({ name: DomainEvent.RobotLeftChunk, payload: { robotId } });
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

  /** Nearest work-flag to a point (the crew rallies to whichever flag is closest).
   *  (Crew-AI surface.) */
  nearestFlag(x: number, y: number): Flag | null {
    return nearest(this.flags.values(), x, y, this.width);
  }

  /** The nested zone with this id, if any. */
  private zoneById(id: number): NestedZone | undefined {
    return this.zones.find((z) => z.id === id);
  }
  /** The nested zone this gate-entity id opens, if any. */
  private zoneByGate(gateId: number): NestedZone | undefined {
    return this.zones.find((z) => z.gateId === gateId);
  }

  /** Drop a robot out of whatever nested zone it's in (on leave / a manual move /
   *  a handoff) so it stops counting against the cap. */
  private leaveZone(robot: Robot): void {
    if (robot.insideZone === null) return;
    this.zoneById(robot.insideZone)?.occupants.delete(robot.id);
    robot.insideZone = null;
  }

  /** A spot inside a chamber for an entering robot — spread so occupants don't stack. */
  private zoneSlotX(zone: NestedZone): number {
    return zone.x + (Math.random() * 2 - 1) * NESTED_ZONE_HALF_W * 0.6;
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

  /** Seed a nested zone (a capped interior chamber within this section). */
  addZone(zone: NestedZone): void {
    this.zones.push(zone);
  }

  /** Live label state for this section's nested zones (appended to S_SECTIONS so a
   *  nested zone is "just another zone with a cap" to the client). */
  zoneStats(): SectionInfo[] {
    return this.zones.map((z) => z.toSectionInfo());
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

  /** Whether any work-flag is planted in this section — the registry uses this to point
   *  the delivery swarm at the flagged section (§ Phase 2 logistics). */
  get hasFlags(): boolean {
    return this.flags.size > 0;
  }

  /** Contract progress (§3) — pieces placed of the blueprint total (section contract;
   *  a nested vault's interior pieces are counted separately). */
  get pieceCount(): number {
    return this.sectionPieceTotal;
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
      // of any weld it was holding/welding, vein it was digging, or chamber it was
      // standing in (walking off frees its nested-zone slot).
      robot.engagedPieceId = null;
      robot.mineUntil = null;
      robot.pendingAction = null;
      this.leaveZone(robot);
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
    // A gate opens a nested zone: tap it to leave (when you're inside) or to walk
    // over and enter it. Entry is opt-in — this gate is the only way in, so a
    // traverser crossing the section is never pulled into the chamber.
    const zone = this.zoneByGate(targetId);
    if (zone) {
      if (robot.insideZone === zone.id) {
        this.leaveZone(robot);
        robot.setTarget(zone.gateX, zone.gateY); // step back down to the gate
      } else {
        robot.setTarget(zone.gateX, zone.gateY);
        robot.pendingAction = { kind: 'enter', targetId };
      }
      return;
    }
    // Tapping the vault's OWN depot/ghosts keeps you inside to work it; tapping
    // anything in another zone (or out on the section floor) means you're leaving, so
    // the chamber slot frees.
    const targetZone =
      this.pieces.get(targetId)?.zoneId ?? this.resources.get(targetId)?.zoneId ?? null;
    if (robot.insideZone !== targetZone) this.leaveZone(robot);
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
   *  pick the next one); couriers ferry to the flagged section; plain NPCs wander;
   *  parked robots hold (§4.7). `now` drives the weld, reservation-TTL, builder-dawdle,
   *  and contract-reset clocks. `flagSection` (if any) is where the delivery swarm
   *  carries material — the registry finds it across the whole planet. */
  step(dt: number, now: number, flagSection: number | null = null): void {
    for (const robot of this.robots.values()) {
      if (robot.engagedPieceId !== null) {
        robot.halt(); // holding/welding — the weld logic frees it
        continue;
      }
      robot.step(dt, this.width);
      if (robot.isNpc) {
        // Builders run the build loop (zone-scoped: a vault crew builds the chamber's
        // interior contract, a section crew builds the floor); couriers ferry material
        // to the flag. Non-builders inside a chamber just hold; outside, they wander.
        if (robot.isBuilder) driveBuilder(this, robot, now);
        else if (robot.isCourier) driveCourier(this, robot, now, flagSection);
        else if (robot.insideZone !== null) {
          // A non-builder resident of a chamber: hold inside, don't wander out.
        }
        // Wanderers roam the WHOLE planet (across sections), so bots flow through
        // checkpoints and queue at busy ones — the section caps come alive (§4.4). A
        // bot that queues too long gives up and turns back (ChunkRegistry.settle), so
        // the queues stay lively but never deadlock.
        else if (!robot.moving) robot.setTarget(Math.random() * this.width, this.wanderY());
      } else if (robot.controlled) {
        this.resolvePending(robot, now);
      }
    }
    this.advanceWelds(now);
    for (const dep of this.deposits.values()) dep.regen(dt); // veins slowly refill
    this.advanceContract(now);
  }

  /** Execute a robot's queued action once it's within interaction range.
   *  ── Internal crew-AI surface: this and the members marked below are public
   *  only for `crewAi.ts` (the builder/courier brains); nothing else calls them. */
  resolvePending(robot: Robot, now: number): void {
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
    } else if (action.kind === 'enter') {
      // Walk to the gate, then opt into the chamber — or queue at the gate if it's
      // at its cap. A nested zone is a HARD cap (even for players): entry is a
      // choice, so a real limit is fair; you ascend the moment a slot frees.
      const zone = this.zoneByGate(action.targetId);
      if (!zone || robot.insideZone === zone.id) {
        robot.pendingAction = null;
        return;
      }
      if (!within(robot, { x: zone.gateX, y: zone.gateY }, this.width)) return; // still walking
      if (zone.isFull) return; // queued at the gate — re-check next tick (no force-admit)
      zone.occupants.add(robot.id);
      robot.insideZone = zone.id;
      robot.setTarget(this.zoneSlotX(zone), zone.y); // ascend into the chamber
      robot.pendingAction = null;
      return; // keep the ascend target (don't fall through to halt)
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
        if (!holder?.carrying || now > piece.reserveDeadline) {
          this.releaseWeld(piece);
        }
      } else if (piece.status === PieceStatus.InProgress) {
        const holder = this.engaged(piece.holderId, piece.id);
        const welder = this.engaged(piece.welderId, piece.id);
        if (!holder?.carrying) {
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
    this.recordPlacement(piece);
  }

  private placePiece(piece: Piece, robot: Robot): void {
    piece.status = PieceStatus.Placed;
    robot.carrying = false;
    this.recordPlacement(piece);
  }

  private recordPlacement(piece: Piece): void {
    // A nested vault's interior piece is built for its own sake — it doesn't advance
    // the section's contract (which would otherwise stall waiting on the chamber).
    if (piece.zoneId !== null) return;
    this.placed += 1;
    this.events.push({
      name: DomainEvent.PiecePlaced,
      payload: { pieceId: piece.id, placed: this.placed, total: this.sectionPieceTotal },
    });
    this.checkContractComplete();
  }

  /** Pieces in the SECTION's main contract (excludes nested-vault interior pieces). */
  private get sectionPieceTotal(): number {
    let n = 0;
    for (const p of this.pieces.values()) if (p.zoneId === null) n += 1;
    return n;
  }

  /** Once a contract completes, hold the celebration briefly, then reset the
   *  blueprint to fresh ghosts so building loops (§2.5 "another contract"). */
  private advanceContract(now: number): void {
    this.advanceVaults(now); // nested vaults loop on their own (independent of the section)
    if (!this.completed) return;
    if (this.completedAt === null) {
      this.completedAt = now;
      return;
    }
    if (now - this.completedAt >= DEFAULT_CONTRACT_RESET_MS) {
      // Reset the SECTION's ghosts (a vault loops separately, see advanceVaults).
      for (const piece of this.pieces.values()) if (piece.zoneId === null) piece.reset();
      this.placed = 0;
      this.completed = false;
      this.completedAt = null;
      this.events.push({
        name: DomainEvent.ContractStarted,
        payload: { total: this.sectionPieceTotal },
      });
    }
  }

  /** Loop each nested vault's interior contract independently of (and faster than) the
   *  section: once all its ghosts are built, hold a brief "done" beat, then reset them
   *  to fresh ghosts — so the chamber stays a living worksite with a window to help. */
  private advanceVaults(now: number): void {
    for (const zone of this.zones) {
      let total = 0;
      let placed = 0;
      for (const p of this.pieces.values()) {
        if (p.zoneId !== zone.id) continue;
        total += 1;
        if (p.status === PieceStatus.Placed) placed += 1;
      }
      if (total === 0 || placed < total) {
        zone.rebuildAt = null; // still building (or no interior contract) — not done
      } else if (zone.rebuildAt === null) {
        zone.rebuildAt = now + VAULT_REBUILD_MS; // just finished — start the beat
      } else if (now >= zone.rebuildAt) {
        for (const p of this.pieces.values()) if (p.zoneId === zone.id) p.reset();
        zone.rebuildAt = null; // fresh ghosts — build it again
      }
    }
  }

  private checkContractComplete(): void {
    const total = this.sectionPieceTotal;
    if (!this.completed && total > 0 && this.placed >= total) {
      this.completed = true;
      this.events.push({
        name: DomainEvent.ContractCompleted,
        payload: { placed: this.placed, total },
      });
    }
  }

  /** A random Y in the band just above the surface — ambient wanderers mill along
   *  the ground rather than floating up into the empty sky. (Crew-AI surface.) */
  wanderY(): number {
    return this.groundY - Math.random() * WANDER_BAND_H;
  }

  /** A random section other than this one (uniform) — a relocating builder's
   *  destination. (Crew-AI surface.) */
  randomOtherSection(): number {
    if (CHUNK_COLS <= 1) return this.id;
    let d = Math.floor(Math.random() * (CHUNK_COLS - 1));
    if (d >= this.id) d += 1; // skip self → uniform over the other sections
    return d;
  }

  /** Nearest depot in the robot's own zone (`zoneId` null = the section; a vault id =
   *  that chamber). A robot only sources from its own zone, so vault crews use the
   *  vault depot and section crews ignore it. (Crew-AI surface.) */
  nearestResource(x: number, y: number, zoneId: number | null): Resource | null {
    return nearest(this.resources.values(), x, y, this.width, (res) => res.zoneId === zoneId);
  }

  /** Nearest ore vein that still has material (for the mining builders).
   *  (Crew-AI surface.) */
  nearestDeposit(x: number, y: number): Deposit | null {
    return nearest(this.deposits.values(), x, y, this.width, (dep) => dep.amount >= 1);
  }

  /** Nearest unbuilt ghost in the robot's own zone — so vault crews build the vault's
   *  interior contract and section crews build the section's (and ignore each
   *  other's). (Crew-AI surface.) */
  nearestGhost(x: number, y: number, zoneId: number | null): Piece | null {
    return nearest(
      this.pieces.values(),
      x,
      y,
      this.width,
      (piece) => piece.status === PieceStatus.Ghost && piece.zoneId === zoneId,
    );
  }

  /** Nearest weld piece that has a holder but no welder yet (a partner is needed),
   *  excluding one held by `excludeRobotId` (you can't weld your own hold).
   *  (Crew-AI surface.) */
  nearestReservedWeld(x: number, y: number, excludeRobotId: number): Piece | null {
    return nearest(
      this.pieces.values(),
      x,
      y,
      this.width,
      (piece) =>
        piece.weld &&
        piece.status === PieceStatus.Reserved &&
        piece.welderId === null &&
        piece.holderId !== excludeRobotId,
    );
  }

  /** Read-only projection of all entities (Phase 0 AOI = whole chunk). */
  fullSnapshot(): EntitySnapshot[] {
    const out: EntitySnapshot[] = [];
    for (const robot of this.robots.values()) out.push(robot.toSnapshot());
    for (const piece of this.pieces.values()) out.push(piece.toSnapshot());
    for (const resource of this.resources.values()) out.push(resource.toSnapshot());
    for (const deposit of this.deposits.values()) out.push(deposit.toSnapshot());
    for (const flag of this.flags.values()) out.push(flag.toSnapshot());
    // A nested zone's gate rides the wire like any other entity (entity-neutral,
    // §4.6); status flips to 1 when the chamber is full so the client reddens it.
    for (const zone of this.zones) {
      out.push({
        id: zone.gateId,
        kind: EntityKind.Gate,
        x: zone.gateX,
        y: zone.gateY,
        status: zone.isFull ? 1 : 0,
      });
    }
    return out;
  }

  /** Drain domain events emitted since the last call (§6 first-class stream). */
  drainEvents(): ChunkEvent[] {
    if (this.events.length === 0) return [];
    return this.events.splice(0, this.events.length);
  }
}

/** Generic nearest-entity scan (wrap-aware): iterate → accept-filter → track best.
 *  The one shape behind every nearest* query above. */
function nearest<T extends { x: number; y: number }>(
  items: Iterable<T>,
  x: number,
  y: number,
  width: number,
  accept?: (item: T) => boolean,
): T | null {
  let best: T | null = null;
  let bestDist = Number.POSITIVE_INFINITY;
  for (const item of items) {
    if (accept && !accept(item)) continue;
    const d = wrappedDistance(x, y, item.x, item.y, width);
    if (d < bestDist) {
      bestDist = d;
      best = item;
    }
  }
  return best;
}

function within(robot: Robot, e: { x: number; y: number }, width: number): boolean {
  return wrappedDistance(robot.x, robot.y, e.x, e.y, width) <= INTERACT_RANGE;
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
