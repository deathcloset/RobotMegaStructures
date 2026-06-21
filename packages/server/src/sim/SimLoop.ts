import { type EntitySnapshot, encodeMessage } from '@rms/shared';
import type { Snapshotter } from '../broadcast/Snapshotter';
import type { ServerConfig } from '../config';
import type { Metrics } from '../metrics/Metrics';
import type { WsGateway } from '../net/WsGateway';
import type { WorldRepo } from '../state/repository';
import type { ChunkRegistry } from './ChunkRegistry';

/**
 * Drift-corrected fixed-rate driver. Two rates (§7.4): the sim steps at tickHz;
 * snapshots broadcast at the slower broadcastHz (a sampling of the sim).
 * Absolute scheduling via setTimeout avoids setInterval drift/coalescing under
 * load.
 */
export class SimLoop {
  private readonly tickIntervalMs: number;
  private readonly ticksPerBroadcast: number;
  private nextTickAt = 0;
  private lastTickWall = Date.now();
  private tick = 0;
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    config: ServerConfig,
    private readonly chunks: ChunkRegistry,
    private readonly gateway: WsGateway,
    private readonly snapshotter: Snapshotter,
    private readonly repo: WorldRepo,
    private readonly metrics: Metrics,
  ) {
    this.tickIntervalMs = 1000 / config.tickHz;
    this.ticksPerBroadcast = Math.max(1, Math.round(config.tickHz / config.broadcastHz));
  }

  start(): void {
    this.running = true;
    this.lastTickWall = Date.now();
    this.nextTickAt = Date.now() + this.tickIntervalMs;
    this.schedule();
  }

  stop(): void {
    this.running = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private schedule(): void {
    if (!this.running) return;
    this.timer = setTimeout(() => this.runTick(), Math.max(0, this.nextTickAt - Date.now()));
  }

  private runTick(): void {
    const start = Date.now();
    const dt = (start - this.lastTickWall) / 1000;
    this.lastTickWall = start;

    // 1. advance simulation
    for (const chunk of this.chunks.all()) chunk.step(dt, start);
    this.tick += 1;

    // 1b. hand off robots that crossed a section boundary to the owning section
    this.chunks.settle();

    // 2. drain + broadcast domain events (the §6 first-class stream)
    for (const chunk of this.chunks.all()) {
      for (const ev of chunk.drainEvents()) this.gateway.broadcastEvent(ev.name, ev.payload);
    }

    // 3. broadcast snapshots at the (slower) broadcast rate
    if (this.tick % this.ticksPerBroadcast === 0) this.broadcast(start);

    // 4. flush per-connection lag-injection queues
    for (const conn of this.gateway.all) conn.drain(start);

    this.metrics.recordTick(Date.now() - start);

    // 5. schedule next tick (drift-corrected; resync if we fell behind)
    this.nextTickAt += this.tickIntervalMs;
    if (this.nextTickAt < Date.now()) this.nextTickAt = Date.now() + this.tickIntervalMs;
    this.schedule();
  }

  private broadcast(now: number): void {
    const bStart = Date.now();
    // Snapshot each section once; each client then gathers only the section(s)
    // under its viewport — so per-client egress stays flat as the world grows (§7).
    const snaps = new Map<number, EntitySnapshot[]>();
    for (const chunk of this.chunks.all()) snaps.set(chunk.id, chunk.fullSnapshot());

    let totalBytes = 0;
    let recipients = 0;
    let totalVisible = 0;
    for (const conn of this.gateway.all) {
      if (!conn.helloOk) continue;
      const inView = this.chunks.chunksInView(conn.viewCx, conn.viewHalfW);
      let entities: EntitySnapshot[];
      if (inView.length === 1) {
        entities = snaps.get(inView[0]!.id)!; // common case: one section, no copy
      } else {
        entities = [];
        for (const c of inView) entities = entities.concat(snaps.get(c.id)!);
      }
      totalVisible += entities.length;
      const bytes = encodeMessage(this.snapshotter.build(conn, entities, this.tick, now));
      totalBytes += bytes.byteLength;
      conn.sendBytes(bytes, now);
      recipients += 1;
    }
    this.metrics.recordBroadcast(
      totalBytes,
      recipients,
      recipients > 0 ? Math.round(totalVisible / recipients) : 0,
    );
    this.metrics.recordBroadcastTime(Date.now() - bStart);

    // periodic durable snapshot seam (no-op in memory; real in Phase 2/3)
    for (const chunk of this.chunks.all()) this.repo.saveChunkSnapshot(chunk);
  }
}
