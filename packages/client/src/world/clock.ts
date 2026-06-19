/**
 * Estimates round-trip time from pong samples for the HUD. NOTE: interpolation
 * timing does NOT use an absolute clock offset — it anchors to the newest
 * received serverTime (see main.ts), which is robust to the asymmetric latency
 * the artificial lag injection introduces.
 */
export class ServerClock {
  private rttMs = 0;

  /** clientTime was performance.now() at ping-send; serverTime is the echo. */
  update(clientTime: number): void {
    const rtt = performance.now() - clientTime;
    this.rttMs = this.rttMs === 0 ? rtt : this.rttMs * 0.8 + rtt * 0.2;
  }

  get rtt(): number {
    return this.rttMs;
  }
}
