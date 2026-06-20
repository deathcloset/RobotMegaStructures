import { type EntityDelta, type EntitySnapshot, wrapDeltaX } from '@rms/shared';
import { interpolateBuffer, type Sample } from './interpolate';

export interface RenderEntity {
  id: number;
  kind: number;
  status: number;
  /** Continuous X (may run outside [0, width) — the renderer wraps it to the
   *  copy nearest the camera). See `addSample`. */
  x: number;
  y: number;
}

/** Per-entity ring buffer of timestamped position samples, sampled at a render
 *  time behind the newest data to smooth 2–5 Hz updates (§7.4). */
export class EntityStore {
  private readonly buffers = new Map<number, Sample[]>();
  private readonly meta = new Map<number, { kind: number; status: number }>();
  /** Last raw (wrapped) X received per entity — used to unwrap into a continuous
   *  coordinate so seam crossings interpolate the short way, not all the way back
   *  around the planet. */
  private readonly lastRawX = new Map<number, number>();
  private worldWidth = 0;
  private static readonly KEEP_MS = 1500;

  /** Learn the planet circumference (from the welcome); enables seam unwrapping. */
  setWorldWidth(width: number): void {
    this.worldWidth = width;
  }

  /** A full snapshot is authoritative about presence. */
  upsertFull(entities: EntitySnapshot[], serverTime: number): void {
    const present = new Set<number>();
    for (const e of entities) {
      present.add(e.id);
      this.addSample(e.id, serverTime, e.x, e.y);
      this.meta.set(e.id, { kind: e.kind, status: e.status });
    }
    for (const id of [...this.buffers.keys()]) {
      if (!present.has(id)) this.remove(id);
    }
  }

  applyDelta(
    added: EntitySnapshot[],
    updated: EntityDelta[],
    removed: number[],
    serverTime: number,
  ): void {
    for (const e of added) {
      this.addSample(e.id, serverTime, e.x, e.y);
      this.meta.set(e.id, { kind: e.kind, status: e.status });
    }
    for (const u of updated) this.addSample(u.id, serverTime, u.x, u.y);
    for (const id of removed) this.remove(id);
  }

  private addSample(id: number, serverTime: number, rawX: number, y: number): void {
    let buf = this.buffers.get(id);
    if (!buf) {
      buf = [];
      this.buffers.set(id, buf);
    }
    // Unwrap the wrapped server X into a continuous coordinate: advance the
    // previous continuous X by the SHORT step across the seam. Without this, a
    // robot stepping 4090 → 5 would lerp backwards across the whole world.
    let x = rawX;
    const prevRaw = this.lastRawX.get(id);
    const last = buf[buf.length - 1];
    if (this.worldWidth > 0 && prevRaw !== undefined && last !== undefined) {
      x = last.x + wrapDeltaX(prevRaw, rawX, this.worldWidth);
    }
    this.lastRawX.set(id, rawX);
    buf.push({ serverTime, x, y });
    const cutoff = serverTime - EntityStore.KEEP_MS;
    while (buf.length > 2 && buf[0]!.serverTime < cutoff) buf.shift();
  }

  private remove(id: number): void {
    this.buffers.delete(id);
    this.meta.delete(id);
    this.lastRawX.delete(id);
  }

  get size(): number {
    return this.buffers.size;
  }

  /** Sample all entities at a render time (server-clock ms). */
  sampleAt(renderServerTime: number): RenderEntity[] {
    const out: RenderEntity[] = [];
    for (const [id, buf] of this.buffers) {
      if (buf.length === 0) continue;
      const p = interpolateBuffer(buf, renderServerTime);
      const m = this.meta.get(id) ?? { kind: 0, status: 0 };
      out.push({ id, kind: m.kind, status: m.status, x: p.x, y: p.y });
    }
    return out;
  }
}
