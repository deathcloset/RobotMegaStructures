import { EntityKind } from '@rms/shared';
import { describe, expect, it } from 'vitest';
import { EntityStore } from './EntityStore';

const W = 4096;
const robot = (x: number) => [{ id: 1, kind: EntityKind.Robot, x, y: 100, status: 0 }];
const xAt = (s: EntityStore, t: number) => s.sampleAt(t).find((e) => e.id === 1)!.x;

describe('EntityStore seam interpolation', () => {
  it('interpolates a seam crossing the SHORT way, not back around the world', () => {
    const store = new EntityStore();
    store.setWorldWidth(W);
    store.upsertFull(robot(4090), 0); // near the right edge
    store.upsertFull(robot(5), 100); // stepped across the seam (+11 the short way)

    // Halfway between the two samples the robot should be just past the seam
    // (~4095.5 in continuous space), i.e. still climbing — never sweeping back
    // toward the middle of the world.
    const mid = xAt(store, 50);
    expect(mid).toBeGreaterThan(4090);
    expect(mid).toBeLessThan(4102);
  });

  it('without a world width it leaves coordinates raw', () => {
    const store = new EntityStore();
    store.upsertFull(robot(4090), 0);
    store.upsertFull(robot(5), 100);
    expect(xAt(store, 100)).toBe(5); // no unwrapping applied
  });
});
