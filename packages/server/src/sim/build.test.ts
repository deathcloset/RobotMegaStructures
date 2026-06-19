import { DomainEvent, MessageType, PieceStatus } from '@rms/shared';
import { describe, expect, it } from 'vitest';
import { Chunk } from './Chunk';
import { Piece } from './Piece';
import { Resource } from './Resource';
import { Robot } from './Robot';

/** Drive the sim forward until `done()` or a step cap, draining no events. */
function run(chunk: Chunk, done: () => boolean, maxSteps = 50): void {
  for (let i = 0; i < maxSteps && !done(); i++) chunk.step(0.1);
}

function setup() {
  const chunk = new Chunk();
  const robot = new Robot(1, 'robot_1', 100, 200, /* owner */ 1);
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
    chunk.applyIntent(robot.id, { t: MessageType.C_INTENT_INTERACT, targetId: depot.id });
    run(chunk, () => robot.carrying);

    expect(robot.carrying).toBe(true);
    const events = chunk.drainEvents();
    expect(events.some((e) => e.name === DomainEvent.ResourcePickedUp)).toBe(true);
  });

  it('delivers a carried resource to a ghost piece, completing the contract', () => {
    const { chunk, robot, depot, piece } = setup();

    chunk.applyIntent(robot.id, { t: MessageType.C_INTENT_INTERACT, targetId: depot.id });
    run(chunk, () => robot.carrying);
    chunk.drainEvents();

    chunk.applyIntent(robot.id, { t: MessageType.C_INTENT_INTERACT, targetId: piece.id });
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
    chunk.applyIntent(robot.id, { t: MessageType.C_INTENT_INTERACT, targetId: piece.id });
    run(chunk, () => piece.status === PieceStatus.Placed, 10);

    expect(robot.pendingAction).toBeNull();
    expect(piece.status).toBe(PieceStatus.Ghost);
  });

  it('a move intent cancels a queued build action', () => {
    const { chunk, robot, depot } = setup();
    chunk.applyIntent(robot.id, { t: MessageType.C_INTENT_INTERACT, targetId: depot.id });
    expect(robot.pendingAction).not.toBeNull();

    chunk.applyIntent(robot.id, { t: MessageType.C_INTENT_MOVE, tx: 500, ty: 500 });
    expect(robot.pendingAction).toBeNull();

    run(chunk, () => false, 5); // robot heads to (500,500), never picks up
    expect(robot.carrying).toBe(false);
  });

  it('does not complete a contract twice', () => {
    const { chunk, robot, depot, piece } = setup();
    chunk.applyIntent(robot.id, { t: MessageType.C_INTENT_INTERACT, targetId: depot.id });
    run(chunk, () => robot.carrying);
    chunk.applyIntent(robot.id, { t: MessageType.C_INTENT_INTERACT, targetId: piece.id });
    run(chunk, () => piece.status === PieceStatus.Placed);
    chunk.drainEvents();

    run(chunk, () => false, 5); // keep ticking after completion
    const names = chunk.drainEvents().map((e) => e.name);
    expect(names).not.toContain(DomainEvent.ContractCompleted);
  });
});
