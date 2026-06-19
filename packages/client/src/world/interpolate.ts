export interface Sample {
  serverTime: number;
  x: number;
  y: number;
}

/**
 * Linear interpolation across a buffer of timestamped samples at server-time `t`.
 * Holds at both ends (no extrapolation beyond known state) so motion never
 * rubber-bands within the latency budget.
 */
export function interpolateBuffer(buf: Sample[], t: number): { x: number; y: number } {
  if (buf.length === 0) return { x: 0, y: 0 };
  const first = buf[0]!;
  if (t <= first.serverTime) return { x: first.x, y: first.y };
  const last = buf[buf.length - 1]!;
  if (t >= last.serverTime) return { x: last.x, y: last.y };
  for (let i = 0; i < buf.length - 1; i++) {
    const a = buf[i]!;
    const b = buf[i + 1]!;
    if (t >= a.serverTime && t <= b.serverTime) {
      const span = b.serverTime - a.serverTime;
      const f = span > 0 ? (t - a.serverTime) / span : 0;
      return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f };
    }
  }
  return { x: last.x, y: last.y };
}
