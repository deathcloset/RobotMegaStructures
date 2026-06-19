import { FP_SCALE } from './constants';

/** Encode a world-unit coordinate to a fixed-point integer for the wire. */
export function toFixed16(value: number): number {
  return Math.round(value * FP_SCALE);
}

/** Decode a fixed-point wire integer back to a world-unit coordinate. */
export function fromFixed16(fixed: number): number {
  return fixed / FP_SCALE;
}
