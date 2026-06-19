import { describe, expect, it } from 'vitest';
import { interpolateBuffer, type Sample } from './interpolate';

describe('interpolateBuffer', () => {
  const buf: Sample[] = [
    { serverTime: 0, x: 0, y: 0 },
    { serverTime: 100, x: 10, y: 0 },
    { serverTime: 200, x: 10, y: 10 },
  ];

  it('holds before the first sample', () => {
    expect(interpolateBuffer(buf, -50)).toEqual({ x: 0, y: 0 });
  });

  it('holds after the last sample (no extrapolation)', () => {
    expect(interpolateBuffer(buf, 999)).toEqual({ x: 10, y: 10 });
  });

  it('lerps between bracketing samples', () => {
    expect(interpolateBuffer(buf, 50)).toEqual({ x: 5, y: 0 });
    expect(interpolateBuffer(buf, 150)).toEqual({ x: 10, y: 5 });
  });

  it('handles an empty buffer', () => {
    expect(interpolateBuffer([], 10)).toEqual({ x: 0, y: 0 });
  });
});
