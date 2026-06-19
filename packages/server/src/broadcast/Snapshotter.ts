import {
  type EntityDelta,
  type EntitySnapshot,
  MessageType,
  type ServerMessage,
} from '@rms/shared';
import type { ServerConfig } from '../config';
import type { Connection } from '../net/Connection';
import { inView } from './interest';

/**
 * Builds the per-client snapshot. Full-vs-delta is the single biggest egress
 * lever (§7.2), exposed as a measured config knob (SNAPSHOT_MODE) so it can be
 * A/B'd with the bot harness.
 */
export class Snapshotter {
  constructor(private readonly config: ServerConfig) {}

  build(conn: Connection, entities: EntitySnapshot[], tick: number, now: number): ServerMessage {
    const visible = entities.filter((e) => inView(conn, e));
    const msg =
      this.config.snapshotMode === 'full'
        ? ({ t: MessageType.S_SNAPSHOT_FULL, tick, serverTime: now, entities: visible } as const)
        : this.buildDelta(conn, visible, tick, now);
    conn.lastTickSent = tick;
    return msg;
  }

  private buildDelta(
    conn: Connection,
    visible: EntitySnapshot[],
    tick: number,
    now: number,
  ): ServerMessage {
    const forceKeyframe = now - conn.lastKeyframeAt >= this.config.keyframeIntervalMs;
    if (forceKeyframe || conn.lastSent.size === 0) {
      conn.lastKeyframeAt = now;
      this.rememberSent(conn, visible);
      return { t: MessageType.S_SNAPSHOT_FULL, tick, serverTime: now, entities: visible };
    }

    const added: EntitySnapshot[] = [];
    const updated: EntityDelta[] = [];
    const seen = new Set<number>();
    for (const e of visible) {
      seen.add(e.id);
      const prev = conn.lastSent.get(e.id);
      if (prev === undefined || prev.status !== e.status) {
        // New, or a non-positional state change (piece placed, robot picked up /
        // dropped a load). Restate the full entity — `updated` carries position
        // only, so a status flip on a static piece would otherwise never ship.
        added.push(e);
      } else if (prev.x !== e.x || prev.y !== e.y) {
        updated.push({ id: e.id, x: e.x, y: e.y });
      }
    }
    const removed: number[] = [];
    for (const id of conn.lastSent.keys()) {
      if (!seen.has(id)) removed.push(id);
    }

    const baseTick = conn.lastTickSent;
    this.rememberSent(conn, visible);
    return {
      t: MessageType.S_SNAPSHOT_DELTA,
      tick,
      baseTick,
      serverTime: now,
      added,
      updated,
      removed,
    };
  }

  private rememberSent(conn: Connection, visible: EntitySnapshot[]): void {
    conn.lastSent.clear();
    for (const e of visible) conn.lastSent.set(e.id, { x: e.x, y: e.y, status: e.status });
  }
}
