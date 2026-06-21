import { CHUNK_COLS, SECTION_WIDTH, WORLD_WIDTH } from './constants';

/**
 * Cylinder geometry — the wrap math decided ONCE, shared byte-for-byte by the
 * server (authoritative movement/distance/AOI) and the client (camera + render).
 * The X axis wraps over [0, width); Y never wraps. Keeping this in one tested
 * module is what lets the seam stay invisible and the two sides stay in agreement
 * (the same discipline as the shared codec).
 */

/** Wrap an X coordinate into the canonical range [0, width). */
export function wrapX(x: number, width = WORLD_WIDTH): number {
  const m = x % width;
  return m < 0 ? m + width : m;
}

/**
 * Shortest signed horizontal step from `from` to `to` around the cylinder, in
 * (-width/2, +width/2]. This is the only correct way to subtract two X values on
 * a wrapping world — a robot near the seam reaches a target "behind" it by going
 * the short way across the seam, not the long way around the planet.
 */
export function wrapDeltaX(from: number, to: number, width = WORLD_WIDTH): number {
  let d = (to - from) % width;
  if (d < 0) d += width; // normalize into [0, width)
  if (d > width / 2) d -= width; // then pick the short direction
  return d;
}

/** Which section (chunk column) a world X falls in: 0..cols-1. The grid indirection
 *  the server uses to route intents and gather per-viewport interest (§4.3). */
export function chunkColOf(x: number, sectionWidth = SECTION_WIDTH, cols = CHUNK_COLS): number {
  const col = Math.floor(wrapX(x, sectionWidth * cols) / sectionWidth);
  // Guard the boundary case where wrapX returns exactly the width (shouldn't, but
  // floating point) — clamp into range.
  return col < 0 ? 0 : col >= cols ? cols - 1 : col;
}

/** X of a section's centre (where its worksite is seeded / framed). */
export function sectionCenterX(col: number, sectionWidth = SECTION_WIDTH): number {
  return col * sectionWidth + sectionWidth / 2;
}

/** Euclidean distance with X measured the short way around the cylinder. */
export function wrappedDistance(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  width = WORLD_WIDTH,
): number {
  const dx = wrapDeltaX(ax, bx, width);
  const dy = by - ay;
  return Math.hypot(dx, dy);
}
