import {
  DEFAULT_BROADCAST_HZ,
  DEFAULT_GRACE_PERIOD_MS,
  DEFAULT_KEYFRAME_INTERVAL_MS,
  DEFAULT_TICK_HZ,
} from '@rms/shared';

export type SnapshotMode = 'full' | 'delta';

export interface ServerConfig {
  host: string;
  port: number;
  tickHz: number;
  broadcastHz: number;
  snapshotMode: SnapshotMode;
  keyframeIntervalMs: number;
  lagMs: number;
  jitterMs: number;
  seedRobots: number;
  seedBuilders: number;
  seedMiners: number;
  /** OSHA cap: max robots allowed in one section before the checkpoint queues (§4.4).
   *  Keep it comfortably above SEED_ROBOTS so each section leaves room for players. */
  sectionCapacity: number;
  /** Hard cap of the nested zone — a capped interior chamber you opt into (§4.4). Set
   *  it low (2–3) to feel the queue at its gate. A resident crew fills cap−1 slots. */
  nestedZoneCap: number;
  metricsLogMs: number;
  gracePeriodMs: number;
}

function num(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const v = Number(raw);
  if (!Number.isFinite(v)) throw new Error(`env ${name} is not a number: ${raw}`);
  return v;
}

function str(name: string, fallback: string): string {
  const raw = process.env[name];
  return raw === undefined || raw === '' ? fallback : raw;
}

export function loadConfig(): ServerConfig {
  const snapshotMode = str('SNAPSHOT_MODE', 'full');
  if (snapshotMode !== 'full' && snapshotMode !== 'delta') {
    throw new Error(`SNAPSHOT_MODE must be 'full' or 'delta', got: ${snapshotMode}`);
  }
  return {
    host: str('HOST', '0.0.0.0'),
    port: num('PORT', 8080),
    tickHz: num('TICK_HZ', DEFAULT_TICK_HZ),
    broadcastHz: num('BROADCAST_HZ', DEFAULT_BROADCAST_HZ),
    snapshotMode,
    keyframeIntervalMs: num('KEYFRAME_INTERVAL_MS', DEFAULT_KEYFRAME_INTERVAL_MS),
    lagMs: num('LAG_MS', 0),
    jitterMs: num('JITTER_MS', 0),
    seedRobots: num('SEED_ROBOTS', 8),
    seedBuilders: num('SEED_BUILDERS', 5),
    seedMiners: num('SEED_MINERS', 2),
    sectionCapacity: num('SECTION_CAPACITY', 12),
    nestedZoneCap: num('NESTED_ZONE_CAP', 3),
    metricsLogMs: num('METRICS_LOG_MS', 5000),
    gracePeriodMs: num('GRACE_PERIOD_MS', DEFAULT_GRACE_PERIOD_MS),
  };
}
