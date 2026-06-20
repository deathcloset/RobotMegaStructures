import { type EntitySnapshot, WORLD_WIDTH, wrapDeltaX } from '@rms/shared';
import type { Connection } from '../net/Connection';

/**
 * Area-of-interest filter (§4.3). A client that hasn't reported a viewport sees
 * everything; once it reports one we filter by it, so the measured egress already
 * reflects real interest management and the multi-chunk subscription is "iterate
 * chunks overlapping the viewport" with no rewrite here. The X test measures the
 * short way around the cylinder, so an entity just across the seam from the
 * viewport stays visible instead of popping at the wrap point.
 */
export function inView(conn: Connection, e: EntitySnapshot, margin = 64): boolean {
  if (!Number.isFinite(conn.viewHalfW) || !Number.isFinite(conn.viewHalfH)) return true;
  return (
    Math.abs(wrapDeltaX(conn.viewCx, e.x, WORLD_WIDTH)) <= conn.viewHalfW + margin &&
    Math.abs(e.y - conn.viewCy) <= conn.viewHalfH + margin
  );
}
