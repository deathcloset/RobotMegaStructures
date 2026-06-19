import type { BotClient } from './BotClient';

/** Aggregates bot stats into a once-per-second table — the client-side mirror of
 *  the server's egress metrics, for A/B'ing full-vs-delta and finding the ceiling. */
export class Reporter {
  private prevBytes = 0;
  private prevSnaps = 0;
  private lastAt = Date.now();

  constructor(private readonly bots: BotClient[]) {}

  print(): void {
    const now = Date.now();
    const dt = (now - this.lastAt) / 1000 || 1;

    let bytes = 0;
    let snaps = 0;
    let connected = 0;
    let errors = 0;
    for (const b of this.bots) {
      bytes += b.stats.bytesIn;
      snaps += b.stats.snapshots;
      if (b.stats.connected) connected += 1;
      errors += b.stats.errors;
    }

    const dBytes = bytes - this.prevBytes;
    const dSnaps = snaps - this.prevSnaps;
    this.prevBytes = bytes;
    this.prevSnaps = snaps;
    this.lastAt = now;

    const kbps = dBytes / 1024 / dt;
    const perClientKbps = connected > 0 ? kbps / connected : 0;

    process.stdout.write(
      `conns=${connected} ` +
        `agg=${kbps.toFixed(0)}KB/s ` +
        `per-client=${perClientKbps.toFixed(2)}KB/s ` +
        `snaps/s=${(dSnaps / dt).toFixed(0)} ` +
        `bytes/snap=${dSnaps > 0 ? (dBytes / dSnaps).toFixed(0) : 0} ` +
        `errors=${errors}\n`,
    );
  }
}
