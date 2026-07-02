import { EntityKind, type EntitySnapshot, MessageType, PieceStatus } from '@rms/shared';
import { describe, expect, it } from 'vitest';
import type { ServerConfig } from '../config';
import { Metrics } from '../metrics/Metrics';
import { Connection } from '../net/Connection';
import { Snapshotter } from './Snapshotter';

function deltaConfig(): ServerConfig {
  return {
    host: '0.0.0.0',
    port: 8080,
    tickHz: 10,
    broadcastHz: 4,
    snapshotMode: 'delta',
    keyframeIntervalMs: 1_000_000, // effectively never force a keyframe in-test
    lagMs: 0,
    jitterMs: 0,
    seedRobots: 0,
    seedBuilders: 0,
    seedMiners: 0,
    sectionCapacity: Number.POSITIVE_INFINITY,
    nestedZoneCap: 3,
    seedCouriers: 0,
    kleptoMinMs: 120_000,
    kleptoSpanMs: 120_000,
    metricsLogMs: 5000,
    gracePeriodMs: 120_000,
  };
}

function conn(): Connection {
  // Snapshotter.build never touches the socket; a stub keeps the test light.
  return new Connection(1, null as never, 0, 0, new Metrics());
}

describe('Snapshotter delta', () => {
  it('ships a piece status change even though the piece never moves', () => {
    const snap = new Snapshotter(deltaConfig());
    const c = conn();

    const robot: EntitySnapshot = { id: 1, kind: EntityKind.Robot, x: 10, y: 10, status: 0 };
    const ghost: EntitySnapshot = {
      id: 1_000_001,
      kind: EntityKind.Piece,
      x: 50,
      y: 50,
      status: PieceStatus.Ghost,
    };

    // First build with an empty baseline is a full keyframe.
    const first = snap.build(c, [robot, ghost], 1, 1000);
    expect(first.t).toBe(MessageType.S_SNAPSHOT_FULL);

    // Robot moves; piece flips ghost → placed (same coords).
    const robot2 = { ...robot, x: 12 };
    const placed = { ...ghost, status: PieceStatus.Placed };
    const second = snap.build(c, [robot2, placed], 2, 1100);

    expect(second.t).toBe(MessageType.S_SNAPSHOT_DELTA);
    if (second.t !== MessageType.S_SNAPSHOT_DELTA) throw new Error('unreachable');
    // Position-only change goes to `updated`...
    expect(second.updated.map((u) => u.id)).toEqual([1]);
    // ...status change restates the full piece in `added`.
    expect(second.added.map((a) => a.id)).toEqual([1_000_001]);
    expect(second.added[0]?.status).toBe(PieceStatus.Placed);
    expect(second.removed).toEqual([]);
  });
});

describe('Snapshotter delta — klepto lifecycle', () => {
  it('restates a stage flip in `added` and ships the despawn in `removed`', () => {
    const snap = new Snapshotter(deltaConfig());
    const c = conn();
    const klepto: EntitySnapshot = {
      id: 6_000_000,
      kind: EntityKind.Klepto,
      x: 700,
      y: 880,
      status: 1,
    };
    const robot: EntitySnapshot = { id: 1, kind: EntityKind.Robot, x: 10, y: 10, status: 0 };

    const first = snap.build(c, [robot, klepto], 1, 1000);
    expect(first.t).toBe(MessageType.S_SNAPSHOT_FULL);

    // Prying → Fleeing-with-loot at the same coords: a pure status change on a
    // momentarily static entity must ride `added` (the HANDOFF gotcha).
    const fleeing = { ...klepto, status: 3 | 8 };
    const second = snap.build(c, [robot, fleeing], 2, 1100);
    expect(second.t).toBe(MessageType.S_SNAPSHOT_DELTA);
    if (second.t !== MessageType.S_SNAPSHOT_DELTA) throw new Error('unreachable');
    expect(second.added.map((a) => a.id)).toEqual([6_000_000]);
    expect(second.added[0]?.status).toBe(11);

    // Beam-out over: the klepto leaves the snapshot → its id rides `removed`.
    const third = snap.build(c, [robot], 3, 1200);
    if (third.t !== MessageType.S_SNAPSHOT_DELTA) throw new Error('unreachable');
    expect(third.removed).toEqual([6_000_000]);
  });
});
