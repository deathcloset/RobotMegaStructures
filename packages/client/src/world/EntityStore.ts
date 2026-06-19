import type { EntityDelta, EntitySnapshot } from '@rms/shared';
import { interpolateBuffer, type Sample } from './interpolate';

export interface RenderEntity {
  id: number;
  kind: number;
  status: number;
  x: number;
  y: number;
}

/** Per-entity ring buffer of timestamped position samples, sampled at a render
 *  time behind the newest data to smooth 2–5 Hz updates (§7.4). */
export class EntityStore {
  private readonly buffers = new Map<number, Sample[]>();
  private readonly meta = new Map<number, { kind: number; status: number }>();
  private static readonly KEEP_MS = 1500;

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

  private addSample(id: number, serverTime: number, x: number, y: number): void {
    let buf = this.buffers.get(id);
    if (!buf) {
      buf = [];
      this.buffers.set(id, buf);
    }
    buf.push({ serverTime, x, y });
    const cutoff = serverTime - EntityStore.KEEP_MS;
    while (buf.length > 2 && buf[0]!.serverTime < cutoff) buf.shift();
  }

  private remove(id: number): void {
    this.buffers.delete(id);
    this.meta.delete(id);
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
