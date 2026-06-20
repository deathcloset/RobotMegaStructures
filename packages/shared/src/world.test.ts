import { describe, expect, it } from 'vitest';
import { wrapDeltaX, wrappedDistance, wrapX } from './world';

const W = 4096;

describe('wrapX', () => {
  it('leaves in-range values untouched', () => {
    expect(wrapX(0, W)).toBe(0);
    expect(wrapX(100, W)).toBe(100);
  });
  it('wraps values past either edge back into [0, width)', () => {
    expect(wrapX(W, W)).toBe(0);
    expect(wrapX(W + 11, W)).toBe(11);
    expect(wrapX(-6, W)).toBe(W - 6);
    expect(wrapX(-W - 6, W)).toBe(W - 6);
  });
});

describe('wrapDeltaX', () => {
  it('matches plain subtraction away from the seam', () => {
    expect(wrapDeltaX(100, 250, W)).toBe(150);
    expect(wrapDeltaX(250, 100, W)).toBe(-150);
  });
  it('takes the SHORT way across the seam', () => {
    // 5 -> 4090 is 11 units the short way (backwards through the seam), not 4085.
    expect(wrapDeltaX(5, 4090, W)).toBe(-11);
    expect(wrapDeltaX(4090, 5, W)).toBe(11);
  });
  it('is bounded by half the circumference', () => {
    expect(Math.abs(wrapDeltaX(0, W / 2 + 1, W))).toBeLessThanOrEqual(W / 2);
    expect(wrapDeltaX(0, W / 2, W)).toBe(W / 2);
  });
});

describe('wrappedDistance', () => {
  it('is short across the seam, not long around the planet', () => {
    // Same X (seam-crossing) → distance is the small wrapped dx, plus the dy.
    expect(wrappedDistance(5, 0, 4090, 0, W)).toBeCloseTo(11);
    expect(wrappedDistance(5, 0, 4090, 3, W)).toBeCloseTo(Math.hypot(11, 3));
  });
});
