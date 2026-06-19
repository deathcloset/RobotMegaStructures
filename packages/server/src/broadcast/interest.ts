import type { EntitySnapshot } from '@rms/shared';
import type { Connection } from '../net/Connection';

/**
 * Area-of-interest filter (§4.3). Phase 0 has one chunk, so a client that hasn't
 * reported a viewport sees everything; once it reports one we filter by it, so
 * the measured egress already reflects real interest management and Phase 2's
 * multi-chunk subscription is "iterate chunks overlapping the viewport" with no
 * rewrite here.
 */
export function inView(conn: Connection, e: EntitySnapshot, margin = 64): boolean {
  if (!Number.isFinite(conn.viewHalfW) || !Number.isFinite(conn.viewHalfH)) return true;
  return (
    Math.abs(e.x - conn.viewCx) <= conn.viewHalfW + margin &&
    Math.abs(e.y - conn.viewCy) <= conn.viewHalfH + margin
  );
}
