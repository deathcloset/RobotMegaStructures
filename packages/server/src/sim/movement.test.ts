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

  describe('on a wrapping world', () => {
    const W = 4096;
    it('takes the short way across the seam', () => {
      // From 5, target 4090 is 11 units away the SHORT way (leftwards, through the
      // seam). At 80 u/s for 0.05s the robot travels 4 units left → x=1, not a trek
      // rightwards across the whole planet.
      const r = advanceToward({ x: 5, y: 0 }, { x: 4090, y: 0 }, 0.05, 80, W);
      expect(r.x).toBeCloseTo(1);
      expect(r.arrived).toBe(false);
    });

    it('wraps the resulting X back into [0, width)', () => {
      // 4 units left of the seam at 80 u/s for 0.1s = 8 units → crosses to ~4092.
      const r = advanceToward({ x: 4, y: 0 }, { x: 4000, y: 0 }, 0.1, 80, W);
      expect(r.x).toBeGreaterThanOrEqual(0);
      expect(r.x).toBeLessThan(W);
      expect(r.x).toBeCloseTo(W - 4); // moved 8 left from x=4 → -4 → wraps to 4092
    });

    it('arrives without wrapping when already at the target', () => {
      const r = advanceToward({ x: 4095, y: 10 }, { x: 4095, y: 10 }, 1, 80, W);
      expect(r.arrived).toBe(true);
    });
  });
});
