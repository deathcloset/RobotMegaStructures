import { describe, expect, it } from 'vitest';
import { fromFixed16, toFixed16 } from './fixedpoint';

describe('fixed-point codec', () => {
  it('round-trips within 1/32 unit for random values in and beyond one chunk', () => {
    for (let i = 0; i < 10_000; i++) {
      const v = Math.random() * 2048 - 512; // include negatives + beyond one chunk
      const back = fromFixed16(toFixed16(v));
      expect(Math.abs(back - v)).toBeLessThanOrEqual(1 / 32 + 1e-9);
    }
  });

  it('is exact for multiples of 1/16', () => {
    expect(fromFixed16(toFixed16(10.0625))).toBe(10.0625);
    expect(fromFixed16(toFixed16(-3.5))).toBe(-3.5);
    expect(fromFixed16(toFixed16(0))).toBe(0);
  });
});
