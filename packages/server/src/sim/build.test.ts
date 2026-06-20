import { DEFAULT_CONTRACT_RESET_MS, DomainEvent, MessageType, PieceStatus } from '@rms/shared';
import { describe, expect, it } from 'vitest';
import { Chunk } from './Chunk';
import { Piece } from './Piece';
import { Resource } from './Resource';
import { Robot } from './Robot';

/** Drive the sim forward until `done()` or a step cap. */
function run(chunk: Chunk, done: () => boolean, maxSteps = 50): void {
  for (let i = 0; i < maxSteps && !done(); i++) chunk.step(0.1, Date.now());
}

function interact(targetId: number) {
  return { t: MessageType.C_INTENT_INTERACT, targetId } as const;
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
