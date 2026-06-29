import {
  DEFAULT_CONTRACT_RESET_MS,
  DEPOSIT_MAX,
  DomainEvent,
  EntityKind,
  MessageType,
  PieceStatus,
  WELD_DURATION_MS,
  WELD_RESERVATION_TTL_MS,
} from '@rms/shared';
import { describe, expect, it } from 'vitest';
import { Chunk } from './Chunk';
import { Deposit } from './Deposit';
import { NestedZone } from './NestedZone';
import { Piece } from './Piece';
import { Resource } from './Resource';
import { Robot } from './Robot';

const interact = (targetId: number) => ({ t: MessageType.C_INTENT_INTERACT, targetId }) as const;
const moveTo = (tx: number, ty: number) => ({ t: MessageType.C_INTENT_MOVE, tx, ty }) as const;

/** Drive the sim forward until `done()` or a step cap. */
function run(chunk: Chunk, done: () => boolean, maxSteps = 50): void {
  for (let i = 0; i < maxSteps && !done(); i++) chunk.step(0.1, Date.now());
}

function setup() {
  const chunk = new Chunk();
  // A controlled player robot (not an NPC; owned by connection 1).
  const robot = new Robot(1, 'robot_1', 100, 200, false, 1);
  chunk.addOccupant(robot);
  const depot = new Resource(2_000_001, 'depot_1', 100, 100);
  chunk.addResource(depot);
  const piece = new Piece(1_000_001, 'piece_1', 300, 100);
  chunk.addPiece(piece);
  chunk.drainEvents(); // discard the entered-chunk event
  return { chunk, robot, depot, piece };
}

describe('build loop', () => {
  it('walks to a depot, picks up, and reports carrying', () => {
    const { chunk, robot, depot } = setup();
    chunk.applyIntent(robot.id, interact(depot.id));
    run(chunk, () => robot.carrying);

    expect(robot.carrying).toBe(true);
    expect(chunk.drainEvents().some((e) => e.name === DomainEvent.ResourcePickedUp)).toBe(true);
  });

  it('delivers a carried resource to a ghost piece, completing the contract', () => {
    const { chunk, robot, depot, piece } = setup();

    chunk.applyIntent(robot.id, interact(depot.id));
    run(chunk, () => robot.carrying);
    chunk.drainEvents();

    chunk.applyIntent(robot.id, interact(piece.id));
    run(chunk, () => piece.status === PieceStatus.Placed);

    expect(piece.status).toBe(PieceStatus.Placed);
    expect(robot.carrying).toBe(false);
    expect(chunk.placedCount).toBe(1);
    expect(chunk.isComplete).toBe(true);

    const names = chunk.drainEvents().map((e) => e.name);
    expect(names).toContain(DomainEvent.PiecePlaced);
    expect(names).toContain(DomainEvent.ContractCompleted);
  });

  it('an empty-handed robot cannot deliver (interacting a piece is a no-op)', () => {
    const { chunk, robot, piece } = setup();
    chunk.applyIntent(robot.id, interact(piece.id));
    run(chunk, () => piece.status === PieceStatus.Placed, 10);

    expect(robot.pendingAction).toBeNull();
    expect(piece.status).toBe(PieceStatus.Ghost);
  });

  it('a move intent cancels a queued build action', () => {
    const { chunk, robot, depot } = setup();
    chunk.applyIntent(robot.id, interact(depot.id));
    expect(robot.pendingAction).not.toBeNull();

    chunk.applyIntent(robot.id, { t: MessageType.C_INTENT_MOVE, tx: 500, ty: 500 });
    expect(robot.pendingAction).toBeNull();

    run(chunk, () => false, 5);
    expect(robot.carrying).toBe(false);
  });

  it('does not complete a contract twice', () => {
    const { chunk, robot, depot, piece } = setup();
    chunk.applyIntent(robot.id, interact(depot.id));
    run(chunk, () => robot.carrying);
    chunk.applyIntent(robot.id, interact(piece.id));
    run(chunk, () => piece.status === PieceStatus.Placed);
    chunk.drainEvents();

    run(chunk, () => false, 5);
    expect(chunk.drainEvents().map((e) => e.name)).not.toContain(DomainEvent.ContractCompleted);
  });

  it('loops the contract: resets to ghosts a beat after completion', () => {
    const { chunk, robot, depot, piece } = setup();
    chunk.applyIntent(robot.id, interact(depot.id));
    run(chunk, () => robot.carrying);
    chunk.applyIntent(robot.id, interact(piece.id));
    run(chunk, () => piece.status === PieceStatus.Placed);
    chunk.drainEvents();

    // Before the reset delay: still complete, still placed.
    chunk.step(0, Date.now());
    expect(chunk.isComplete).toBe(true);

    // Past the reset delay: blueprint goes back to ghosts and re-arms.
    chunk.step(0, Date.now() + DEFAULT_CONTRACT_RESET_MS + 100);
    expect(piece.status).toBe(PieceStatus.Ghost);
    expect(chunk.placedCount).toBe(0);
    expect(chunk.isComplete).toBe(false);
    expect(chunk.drainEvents().map((e) => e.name)).toContain(DomainEvent.ContractStarted);
  });
});

describe('NPC builder bots', () => {
  it('autonomously hauls from a depot and places a ghost piece', () => {
    const chunk = new Chunk();
    const builder = new Robot(-1, 'npc_1', 100, 200, true);
    builder.isBuilder = true;
    chunk.addOccupant(builder);
    chunk.addResource(new Resource(2_000_001, 'depot_1', 100, 100));
    const piece = new Piece(1_000_001, 'piece_1', 300, 100);
    chunk.addPiece(piece);

    // Drive enough ticks for think → walk → pickup → walk → deliver (now advances
    // so the builder's dawdle timer elapses between actions).
    for (let i = 0; i < 300 && piece.status !== PieceStatus.Placed; i++) {
      chunk.step(0.1, i * 100);
    }

    expect(piece.status).toBe(PieceStatus.Placed);
    expect(builder.carrying).toBe(false);
  });
});

describe('two-robot weld (§10)', () => {
  /** A weld piece with a holder already carrying nearby and an idle welder. */
  function weldSetup() {
    const chunk = new Chunk();
    const holder = new Robot(1, 'holder', 110, 130, false, 1);
    holder.carrying = true; // arrived with the beam
    const welder = new Robot(2, 'welder', 130, 130, false, 2);
    chunk.addOccupant(holder);
    chunk.addOccupant(welder);
    const weld = new Piece(1_000_001, 'weld_1', 120, 100, true);
    chunk.addPiece(weld);
    chunk.drainEvents();
    let now = 0;
    const until = (cond: () => boolean, max = 200): void => {
      for (let i = 0; i < max && !cond(); i++) {
        now += 100;
        chunk.step(0.1, now);
      }
    };
    const jump = (ms: number): void => {
      now += ms;
      chunk.step(0.1, now);
    };
    return { chunk, holder, welder, weld, until, jump };
  }

  it('two robots (holder + welder) complete a weld piece', () => {
    const { chunk, holder, welder, weld, until, jump } = weldSetup();

    chunk.applyIntent(holder.id, interact(weld.id));
    until(() => weld.status === PieceStatus.Reserved);
    expect(weld.status).toBe(PieceStatus.Reserved);
    expect(weld.holderId).toBe(holder.id);
    expect(holder.carrying).toBe(true); // still holding the beam

    chunk.applyIntent(welder.id, interact(weld.id));
    until(() => weld.status === PieceStatus.InProgress);
    expect(weld.status).toBe(PieceStatus.InProgress);

    jump(WELD_DURATION_MS + 50); // both stay engaged → weld finishes
    expect(weld.status).toBe(PieceStatus.Placed);
    expect(holder.carrying).toBe(false); // beam consumed
    expect(chunk.placedCount).toBe(1);
    expect(chunk.drainEvents().map((e) => e.name)).toContain(DomainEvent.PiecePlaced);
  });

  it('releases a lone reservation after the TTL (no deadlock)', () => {
    const { chunk, holder, weld, until, jump } = weldSetup();
    chunk.applyIntent(holder.id, interact(weld.id));
    until(() => weld.status === PieceStatus.Reserved);

    jump(WELD_RESERVATION_TTL_MS + 100); // no welder ever came
    expect(weld.status).toBe(PieceStatus.Ghost);
    expect(weld.holderId).toBeNull();
    expect(holder.carrying).toBe(true); // holder keeps its beam to try elsewhere
    expect(chunk.drainEvents().map((e) => e.name)).toContain(DomainEvent.PieceReleased);
  });

  it('releases the piece if the holder drops while reserved', () => {
    const { chunk, holder, weld, until, jump } = weldSetup();
    chunk.applyIntent(holder.id, interact(weld.id));
    until(() => weld.status === PieceStatus.Reserved);

    chunk.removeOccupant(holder.id); // holder vanishes (grace expired)
    jump(100);
    expect(weld.status).toBe(PieceStatus.Ghost);
  });

  it('demotes back to reserved if the welder leaves mid-weld', () => {
    const { chunk, holder, welder, weld, until, jump } = weldSetup();
    chunk.applyIntent(holder.id, interact(weld.id));
    until(() => weld.status === PieceStatus.Reserved);
    chunk.applyIntent(welder.id, interact(weld.id));
    until(() => weld.status === PieceStatus.InProgress);

    chunk.applyIntent(welder.id, moveTo(800, 800)); // welder walks off
    jump(100);
    expect(weld.status).toBe(PieceStatus.Reserved);
    expect(weld.welderId).toBeNull();
    expect(holder.carrying).toBe(true);
  });

  it('two builder bots weld a piece autonomously', () => {
    const chunk = new Chunk();
    const b1 = new Robot(-1, 'bot_1', 100, 200, true);
    b1.isBuilder = true;
    const b2 = new Robot(-2, 'bot_2', 200, 200, true);
    b2.isBuilder = true;
    chunk.addOccupant(b1);
    chunk.addOccupant(b2);
    chunk.addResource(new Resource(2_000_001, 'depot', 150, 250));
    const weld = new Piece(1_000_001, 'weld_1', 150, 100, true);
    chunk.addPiece(weld);

    let now = 0;
    for (let i = 0; i < 800 && weld.status !== PieceStatus.Placed; i++) {
      now += 100;
      chunk.step(0.1, now);
    }
    expect(weld.status).toBe(PieceStatus.Placed);
  });
});

describe('grace-period parking (§4.7)', () => {
  it('a parked robot holds position, keeps its load, and does not wander', () => {
    const { chunk, robot } = setup();
    robot.carrying = true;

    // Mimic the gateway parking the robot when its owner drops.
    robot.ownerConnectionId = null;
    robot.halt();
    expect(robot.parked).toBe(true);

    const x0 = robot.x;
    const y0 = robot.y;
    for (let i = 0; i < 20; i++) chunk.step(0.1, Date.now());

    expect(robot.x).toBe(x0);
    expect(robot.y).toBe(y0);
    expect(robot.carrying).toBe(true); // load survives for the reconnecting owner
  });
});

describe('surface mining (§ Phase 2)', () => {
  it('Deposit.extract depletes, refuses an empty vein, and regen caps at max', () => {
    const d = new Deposit(3_000_001, 'ore', 0, 0, 1);
    expect(d.extract()).toBe(true);
    expect(d.amount).toBe(0);
    expect(d.extract()).toBe(false); // tapped out
    d.regen(1000); // a huge dt
    expect(d.amount).toBe(DEPOSIT_MAX); // refill is capped at the vein's max
  });

  function mineSetup(amount = DEPOSIT_MAX) {
    const chunk = new Chunk();
    const robot = new Robot(1, 'r', 100, 200, false, 1);
    chunk.addOccupant(robot);
    const dep = new Deposit(3_000_001, 'ore', 100, 120, amount);
    chunk.addDeposit(dep);
    chunk.drainEvents();
    let now = 0;
    const until = (cond: () => boolean, max = 400): void => {
      for (let i = 0; i < max && !cond(); i++) {
        now += 100;
        chunk.step(0.1, now);
      }
    };
    return { chunk, robot, dep, until };
  }

  it('digs an ore vein into a carried load and emits a pickup', () => {
    const { chunk, robot, dep, until } = mineSetup();
    chunk.applyIntent(robot.id, interact(dep.id));
    until(() => robot.carrying);

    expect(robot.carrying).toBe(true);
    expect(dep.amount).toBeLessThan(DEPOSIT_MAX); // a load came out
    expect(dep.amount).toBeGreaterThan(DEPOSIT_MAX - 2); // ...just the one
    expect(chunk.drainEvents().map((e) => e.name)).toContain(DomainEvent.ResourcePickedUp);
  });

  it('will not mine a tapped-out vein', () => {
    const { chunk, robot, until } = mineSetup(0);
    chunk.applyIntent(robot.id, interact(3_000_001));
    expect(robot.pendingAction).toBeNull(); // nothing queued for an empty vein

    until(() => robot.carrying, 20);
    expect(robot.carrying).toBe(false);
  });

  it('mined material feeds the build loop (deliver places a ghost)', () => {
    const { chunk, robot, dep, until } = mineSetup();
    const piece = new Piece(1_000_001, 'p', 100, 300);
    chunk.addPiece(piece);

    chunk.applyIntent(robot.id, interact(dep.id));
    until(() => robot.carrying);
    chunk.applyIntent(robot.id, interact(piece.id));
    until(() => piece.status === PieceStatus.Placed);

    expect(piece.status).toBe(PieceStatus.Placed);
    expect(robot.carrying).toBe(false);
  });

  it('a prospector builder sources from an ore vein autonomously', () => {
    const chunk = new Chunk();
    const builder = new Robot(-1, 'npc', 100, 200, true);
    builder.isBuilder = true;
    builder.prefersMining = true;
    chunk.addOccupant(builder);
    chunk.addDeposit(new Deposit(3_000_001, 'ore', 120, 120, DEPOSIT_MAX));
    const piece = new Piece(1_000_001, 'p', 300, 120);
    chunk.addPiece(piece);

    // think → walk to the vein → dig → walk to the ghost → deliver (now advances so
    // the dawdle + dig timers elapse).
    let now = 0;
    for (let i = 0; i < 600 && piece.status !== PieceStatus.Placed; i++) {
      now += 100;
      chunk.step(0.1, now);
    }

    expect(piece.status).toBe(PieceStatus.Placed); // built from mined ore, no depot
  });
});

describe('commandable crews — work-flags (§ Phase 2)', () => {
  const flagAt = (tx: number, ty: number) => ({ t: MessageType.C_INTENT_FLAG, tx, ty }) as const;
  const flagsOf = (chunk: Chunk) => chunk.fullSnapshot().filter((e) => e.kind === EntityKind.Flag);

  it('plants a work-flag on the surface and moves it on a second drop', () => {
    const chunk = new Chunk();
    const robot = new Robot(1, 'r', 100, 200, false, 1);
    chunk.addOccupant(robot);

    chunk.applyIntent(robot.id, flagAt(500, 100));
    let flags = flagsOf(chunk);
    expect(flags).toHaveLength(1);
    expect(flags[0]!.status).toBe(robot.id); // owner id rides as status
    expect(flags[0]!.x).toBe(500);
    expect(flags[0]!.y).toBe(chunk.groundY - 8); // snapped to the surface

    chunk.applyIntent(robot.id, flagAt(900, 100));
    flags = flagsOf(chunk);
    expect(flags).toHaveLength(1); // moved, not duplicated
    expect(flags[0]!.x).toBe(900);
  });

  it('picks the flag up when its owner taps it, and clears it when they leave', () => {
    const chunk = new Chunk();
    const robot = new Robot(1, 'r', 100, 200, false, 1);
    chunk.addOccupant(robot);

    chunk.applyIntent(robot.id, flagAt(500, 100));
    chunk.applyIntent(robot.id, interact(4_000_000 + robot.id)); // tap own flag
    expect(flagsOf(chunk)).toHaveLength(0);

    chunk.applyIntent(robot.id, flagAt(500, 100));
    chunk.removeOccupant(robot.id); // owner departs
    expect(flagsOf(chunk)).toHaveLength(0);
  });

  it('rallies a builder to mine the vein by the flag, not the one nearest the builder', () => {
    const chunk = new Chunk();
    const builder = new Robot(-1, 'npc', 100, 820, true);
    builder.isBuilder = true;
    chunk.addOccupant(builder);
    const near = new Deposit(3_000_001, 'near', 130, 820, DEPOSIT_MAX); // next to the builder
    const far = new Deposit(3_000_002, 'far', 1500, 820, DEPOSIT_MAX); // by the flag
    chunk.addDeposit(near);
    chunk.addDeposit(far);
    const commander = new Robot(1, 'p', 1480, 820, false, 1);
    chunk.addOccupant(commander);
    chunk.applyIntent(commander.id, flagAt(1500, 820));

    chunk.step(0.1, 100); // one think tick
    expect(builder.pendingAction).toEqual({ kind: 'mine', targetId: far.id });
  });
});

describe('nested zones — capped interior chambers (§4.4)', () => {
  const GATE = 5_000_000;
  // A chunk (uncapped ring, so only the nested cap is in play) with one nested zone:
  // a gate on the surface at x=200 and a chamber above it.
  function withZone(cap: number) {
    const chunk = new Chunk(0);
    const zone = new NestedZone(100, 0, cap, 200, 500, GATE, 200, 800);
    chunk.addZone(zone);
    return { chunk, zone };
  }
  // A controlled player standing right at the gate (in range immediately).
  function playerAtGate(chunk: Chunk, id = 1) {
    const p = new Robot(id, `p${id}`, 200, 800, false, id);
    chunk.addOccupant(p);
    chunk.drainEvents();
    return p;
  }
  // A resident worker living in the chamber (occupies a slot, doesn't wander).
  function seedResident(chunk: Chunk, zone: NestedZone, id = -9) {
    const r = new Robot(id, `res${-id}`, 200, 500, true);
    r.insideZone = zone.id;
    chunk.addOccupant(r);
    zone.occupants.add(id);
    return r;
  }

  it('lets a player opt in through the gate and take a slot', () => {
    const { chunk, zone } = withZone(2);
    const p = playerAtGate(chunk);
    chunk.applyIntent(1, interact(GATE));
    run(chunk, () => p.insideZone !== null);
    expect(p.insideZone).toBe(100);
    expect(zone.count).toBe(1);
    expect(chunk.zoneStats()[0]).toMatchObject({ id: 100, cap: 2, count: 1, nested: true });
  });

  it('is a HARD cap — a full chamber queues the next player and never force-admits', () => {
    const { chunk, zone } = withZone(1);
    seedResident(chunk, zone); // chamber full (cap 1)
    const p = playerAtGate(chunk);
    chunk.applyIntent(1, interact(GATE));
    // Step well past the sections' bounded wait (3s) — a nested zone never relents.
    for (let i = 0; i < 100; i++) chunk.step(0.1, i * 100); // ~10s
    expect(p.insideZone).toBeNull(); // still outside, queued at the gate
    expect(p.pendingAction?.kind).toBe('enter');
    expect(zone.count).toBe(1);
  });

  it('admits a queued player the moment a slot frees', () => {
    const { chunk, zone } = withZone(1);
    seedResident(chunk, zone);
    const p = playerAtGate(chunk);
    chunk.applyIntent(1, interact(GATE));
    chunk.step(0.1, 100);
    expect(p.insideZone).toBeNull(); // blocked while full

    chunk.removeOccupant(-9); // the resident leaves → a slot opens
    run(chunk, () => p.insideZone !== null);
    expect(p.insideZone).toBe(100);
    expect(zone.count).toBe(1);
  });

  it('leaves the chamber on a second gate tap, freeing the slot', () => {
    const { chunk, zone } = withZone(2);
    const p = playerAtGate(chunk);
    chunk.applyIntent(1, interact(GATE));
    run(chunk, () => p.insideZone !== null);
    expect(zone.count).toBe(1);

    chunk.applyIntent(1, interact(GATE)); // tap the gate again → leave (immediate)
    expect(p.insideZone).toBeNull();
    expect(zone.count).toBe(0);
  });

  it('lets a manual move walk a player out of the chamber', () => {
    const { chunk, zone } = withZone(2);
    const p = playerAtGate(chunk);
    chunk.applyIntent(1, interact(GATE));
    run(chunk, () => p.insideZone !== null);

    chunk.applyIntent(1, moveTo(900, 800)); // walk off elsewhere
    expect(p.insideZone).toBeNull();
    expect(zone.count).toBe(0);
  });

  it('never auto-pulls a traverser in — standing at the gate is not entering', () => {
    const { chunk, zone } = withZone(3);
    const p = playerAtGate(chunk); // sitting on the gate, but with no enter intent
    for (let i = 0; i < 20; i++) chunk.step(0.1, i * 100);
    expect(p.insideZone).toBeNull();
    expect(zone.count).toBe(0);
  });

  it('frees the slot when an occupant leaves the section entirely', () => {
    const { chunk, zone } = withZone(2);
    const p = playerAtGate(chunk);
    chunk.applyIntent(1, interact(GATE));
    run(chunk, () => p.insideZone !== null);
    expect(zone.count).toBe(1);

    chunk.removeOccupant(1); // handed off / disconnected
    expect(zone.count).toBe(0);
  });

  it('reports the gate as an entity whose status flips when the chamber fills', () => {
    const { chunk, zone } = withZone(1);
    const gateOf = () => chunk.fullSnapshot().find((e) => e.id === GATE);
    expect(gateOf()).toMatchObject({ kind: EntityKind.Gate, status: 0 }); // room
    seedResident(chunk, zone);
    expect(gateOf()).toMatchObject({ kind: EntityKind.Gate, status: 1 }); // full
  });
});

describe('vault worksite — a reason to enter (§4.4)', () => {
  const GATE = 5_000_000;
  // A chunk with a nested vault that has its own interior worksite (a ghost + a depot in
  // the chamber, tagged with the zone id) plus a section ghost + depot on the floor.
  function withVault(cap = 3) {
    const chunk = new Chunk(0);
    const zone = new NestedZone(100, 0, cap, 200, 500, GATE, 200, 800);
    chunk.addZone(zone);
    const vaultGhost = new Piece(1_000_900, 'vg', 200, 500, false);
    vaultGhost.zoneId = 100;
    chunk.addPiece(vaultGhost);
    const vaultDepot = new Resource(2_000_900, 'vd', 200, 520);
    vaultDepot.zoneId = 100;
    chunk.addResource(vaultDepot);
    const sectionGhost = new Piece(1_000_001, 'sg', 320, 820, false);
    chunk.addPiece(sectionGhost);
    const sectionDepot = new Resource(2_000_001, 'sd', 300, 820);
    chunk.addResource(sectionDepot);
    chunk.drainEvents();
    return { chunk, zone, vaultGhost, sectionGhost };
  }
  // Autonomous NPC builders dawdle on sim time, so advance `now` like the real loop.
  function autorun(chunk: Chunk, done: () => boolean, max = 500): void {
    let now = 0;
    for (let i = 0; i < max && !done(); i++) {
      now += 100;
      chunk.step(0.1, now);
    }
  }

  it('a player enters and builds the vault piece — without leaving, without touching the section contract', () => {
    const { chunk, vaultGhost, sectionGhost } = withVault(3);
    const p = new Robot(1, 'p', 200, 800, false, 1);
    chunk.addOccupant(p);

    chunk.applyIntent(1, interact(GATE));
    run(chunk, () => p.insideZone !== null, 120);
    expect(p.insideZone).toBe(100);

    chunk.applyIntent(1, interact(2_000_900)); // grab from the vault's own depot
    run(chunk, () => p.carrying, 120);
    expect(p.insideZone).toBe(100); // tapping the vault's depot kept us inside
    chunk.applyIntent(1, interact(1_000_900)); // deliver to the vault ghost
    run(chunk, () => vaultGhost.status === PieceStatus.Placed, 120);

    expect(vaultGhost.status).toBe(PieceStatus.Placed);
    expect(p.insideZone).toBe(100); // still inside after building
    expect(sectionGhost.status).toBe(PieceStatus.Ghost); // section contract untouched
  });

  it('a resident builder builds the vault contract on its own and never leaves', () => {
    const { chunk, zone, vaultGhost } = withVault(3);
    const r = new Robot(-1, 'r', 200, 500, true);
    r.isBuilder = true;
    r.insideZone = 100;
    chunk.addOccupant(r);
    zone.occupants.add(-1);

    autorun(chunk, () => vaultGhost.status === PieceStatus.Placed);
    expect(vaultGhost.status).toBe(PieceStatus.Placed);
    expect(r.insideZone).toBe(100); // stayed in the chamber the whole time
  });

  it('an outside builder builds the section contract only — it ignores the vault interior', () => {
    const { chunk, vaultGhost, sectionGhost } = withVault(3);
    const b = new Robot(-1, 'b', 320, 820, true);
    b.isBuilder = true;
    chunk.addOccupant(b);

    autorun(chunk, () => sectionGhost.status === PieceStatus.Placed);
    expect(sectionGhost.status).toBe(PieceStatus.Placed);
    expect(vaultGhost.status).toBe(PieceStatus.Ghost); // never touched the vault
  });

  it('the section contract completes without the vault piece (the vault never stalls it)', () => {
    const { chunk, vaultGhost } = withVault(3);
    const b = new Robot(-1, 'b', 320, 820, true);
    b.isBuilder = true;
    chunk.addOccupant(b);

    let completed = false;
    let now = 0;
    for (let i = 0; i < 500 && !completed; i++) {
      now += 100;
      chunk.step(0.1, now);
      for (const e of chunk.drainEvents()) {
        if (e.name === DomainEvent.ContractCompleted) completed = true;
      }
    }
    expect(completed).toBe(true); // finished with only its own (section) piece
    expect(vaultGhost.status).toBe(PieceStatus.Ghost); // the unbuilt vault didn't block it
  });

  it('tapping section-floor work from inside the vault leaves the chamber', () => {
    const { chunk, zone } = withVault(3);
    const p = new Robot(1, 'p', 200, 800, false, 1);
    chunk.addOccupant(p);
    chunk.applyIntent(1, interact(GATE));
    run(chunk, () => p.insideZone !== null, 120);
    expect(p.insideZone).toBe(100);

    chunk.applyIntent(1, interact(2_000_001)); // tap a section depot (a different zone)
    expect(p.insideZone).toBeNull(); // left the chamber to go work the floor
    expect(zone.count).toBe(0);
  });

  it('loops the vault contract on its own — it rebuilds to fresh ghosts after a beat', () => {
    const { chunk, vaultGhost } = withVault(3);
    const r = new Robot(-1, 'r', 200, 500, true);
    r.isBuilder = true;
    r.insideZone = 100;
    chunk.addOccupant(r);

    let wasBuilt = false;
    let sawReset = false;
    let now = 0;
    for (let i = 0; i < 250; i++) {
      now += 100;
      chunk.step(0.1, now);
      if (vaultGhost.status === PieceStatus.Placed) wasBuilt = true;
      if (wasBuilt && vaultGhost.status === PieceStatus.Ghost) sawReset = true;
    }
    expect(wasBuilt).toBe(true); // the resident built it
    expect(sawReset).toBe(true); // …and it looped back to a ghost (independent of the section)
  });
});
