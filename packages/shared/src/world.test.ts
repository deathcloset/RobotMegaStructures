import { describe, expect, it } from 'vitest';
import { chunkColOf, sectionCenterX, wrapDeltaX, wrappedDistance, wrapX } from './world';

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

describe('chunkColOf', () => {
  // 4 sections of 1000 → cols 0..3.
  it('maps a world X to its section column', () => {
    expect(chunkColOf(0, 1000, 4)).toBe(0);
    expect(chunkColOf(999, 1000, 4)).toBe(0);
    expect(chunkColOf(1000, 1000, 4)).toBe(1);
    expect(chunkColOf(3500, 1000, 4)).toBe(3);
  });
  it('wraps and clamps at the edges', () => {
    expect(chunkColOf(4000, 1000, 4)).toBe(0); // == width → wraps to 0
    expect(chunkColOf(-1, 1000, 4)).toBe(3); // just left of the seam
  });
});

describe('sectionCenterX', () => {
  it('returns the middle of a section', () => {
    expect(sectionCenterX(0, 1000)).toBe(500);
    expect(sectionCenterX(2, 1000)).toBe(2500);
  });
});

describe('wrappedDistance', () => {
  it('is short across the seam, not long around the planet', () => {
    // Same X (seam-crossing) → distance is the small wrapped dx, plus the dy.
    expect(wrappedDistance(5, 0, 4090, 0, W)).toBeCloseTo(11);
    expect(wrappedDistance(5, 0, 4090, 3, W)).toBeCloseTo(Math.hypot(11, 3));
  });
});
