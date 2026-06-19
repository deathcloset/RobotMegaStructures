import { describe, expect, it } from 'vitest';
import { advanceToward } from './movement';

describe('advanceToward', () => {
  it('moves at constant speed toward the target', () => {
    const r = advanceToward({ x: 0, y: 0 }, { x: 100, y: 0 }, 0.1, 80);
    expect(r.x).toBeCloseTo(8); // 80 u/s * 0.1 s
    expect(r.y).toBeCloseTo(0);
    expect(r.arrived).toBe(false);
  });

  it('snaps to target and reports arrival within epsilon', () => {
    const r = advanceToward({ x: 99.5, y: 0 }, { x: 100, y: 0 }, 1, 80);
    expect(r.arrived).toBe(true);
    expect(r.x).toBe(100);
  });

  it('does not overshoot a near target', () => {
    const r = advanceToward({ x: 0, y: 0 }, { x: 5, y: 0 }, 1, 80);
    expect(r.x).toBe(5);
    expect(r.y).toBe(0);
  });
});
