/**
 * Bandwidth is the whole feasibility case (§7.2), so egress is instrumented from
 * commit #1. The north-star number is bytes/player/tick — measured per snapshot
 * mode so full-vs-delta can be A/B'd with the bot harness.
 */
export class Metrics {
  private egressBytesWindow = 0;
  private egressBytesPerSec = 0;
  private lastSampleAt = Date.now();

  private lastBroadcastBytes = 0;
  private lastBroadcastRecipients = 0;

  private readonly tickSamples: number[] = [];
  private readonly broadcastSamples: number[] = [];
  private static readonly RING = 240;

  connections = 0;
  messagesIn = 0;
  intentsApplied = 0;
  lastEntitiesInView = 0;
  tickCount = 0;
  /** Bots currently queued at section checkpoints (§4.4) — set each tick. */
  queued = 0;
  /** Ticks that threw and were absorbed by the SimLoop crash guard. */
  tickErrors = 0;
  /** Klepto incursions resolved (§3 slapstick) — the live-wire observables. */
  kleptoCaptured = 0;
  kleptoEscaped = 0;

  recordEgress(bytes: number): void {
    this.egressBytesWindow += bytes;
  }

  recordBroadcast(totalBytes: number, recipients: number, entitiesInView: number): void {
    this.lastBroadcastBytes = totalBytes;
    this.lastBroadcastRecipients = recipients;
    this.lastEntitiesInView = entitiesInView;
  }

  recordTick(ms: number): void {
    this.tickCount += 1;
    push(this.tickSamples, ms, Metrics.RING);
  }

  recordBroadcastTime(ms: number): void {
    push(this.broadcastSamples, ms, Metrics.RING);
  }

  /** Roll the egress window into a rate; call ~1/sec. */
  sample(now = Date.now()): void {
    const dt = (now - this.lastSampleAt) / 1000;
    if (dt <= 0) return;
    this.egressBytesPerSec = this.egressBytesWindow / dt;
    this.egressBytesWindow = 0;
    this.lastSampleAt = now;
  }

  get bytesPerPlayerPerTick(): number {
    return this.lastBroadcastRecipients > 0
      ? this.lastBroadcastBytes / this.lastBroadcastRecipients
      : 0;
  }

  snapshot(): Record<string, number> {
    return {
      connections: this.connections,
      egress_bytes_per_sec: Math.round(this.egressBytesPerSec),
      egress_kbps: round1(this.egressBytesPerSec / 1024),
      bytes_per_player_per_tick: Math.round(this.bytesPerPlayerPerTick),
      last_broadcast_bytes: this.lastBroadcastBytes,
      entities_in_view: this.lastEntitiesInView,
      messages_in: this.messagesIn,
      intents_applied: this.intentsApplied,
      queued: this.queued,
      tick_count: this.tickCount,
      tick_errors: this.tickErrors,
      klepto_captured: this.kleptoCaptured,
      klepto_escaped: this.kleptoEscaped,
      tick_ms_p50: pct(this.tickSamples, 0.5),
      tick_ms_p95: pct(this.tickSamples, 0.95),
      tick_ms_max: this.tickSamples.length ? round2(Math.max(...this.tickSamples)) : 0,
      broadcast_ms_p95: pct(this.broadcastSamples, 0.95),
    };
  }
}

function push(arr: number[], v: number, cap: number): void {
  arr.push(v);
  if (arr.length > cap) arr.shift();
}

function pct(arr: number[], p: number): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor(p * sorted.length));
  return round2(sorted[idx]!);
}

function round1(v: number): number {
  return Math.round(v * 10) / 10;
}
function round2(v: number): number {
  return Math.round(v * 100) / 100;
}
