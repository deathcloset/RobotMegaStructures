import {
  DEFAULT_CONTRACT_RESET_MS,
  DEPOSIT_MAX,
  DomainEvent,
  MessageType,
  PieceStatus,
  WELD_DURATION_MS,
  WELD_RESERVATION_TTL_MS,
} from '@rms/shared';
import { describe, expect, it } from 'vitest';
import { Chunk } from './Chunk';
import { Deposit } from './Deposit';
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
});
