import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Connection } from './Connection';

/** Minimal stand-in for the browser WebSocket, with hooks to drive lifecycle. */
class FakeWS {
  static instances: FakeWS[] = [];
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  binaryType = '';
  readyState: number = FakeWS.CONNECTING;
  closed = false;
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: ArrayBuffer }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(public url: string) {
    FakeWS.instances.push(this);
  }
  send(): void {}
  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.readyState = FakeWS.CLOSED;
    this.onclose?.();
  }
  fireOpen(): void {
    this.readyState = FakeWS.OPEN;
    this.onopen?.();
  }
}

let nowMs = 0;
function advance(ms: number): void {
  nowMs += ms;
  vi.advanceTimersByTime(ms);
}
const live = () => FakeWS.instances.filter((w) => !w.closed);
const last = () => FakeWS.instances[FakeWS.instances.length - 1]!;

beforeEach(() => {
  nowMs = 0;
  FakeWS.instances = [];
  vi.useFakeTimers();
  vi.stubGlobal('WebSocket', FakeWS as unknown as typeof WebSocket);
  vi.stubGlobal('window', globalThis);
  vi.stubGlobal('performance', { now: () => nowMs });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('Connection resilience (§4.7)', () => {
  it('opens and reports status', () => {
    const c = new Connection('ws://x/ws', 0, 0);
    let opened = 0;
    c.onOpen = () => {
      opened++;
    };
    c.connect();
    expect(FakeWS.instances).toHaveLength(1);
    last().fireOpen();
    expect(c.connected).toBe(true);
    expect(opened).toBe(1);
    expect(c.status).toBe('open');
  });

  it('reconnects after the socket drops', () => {
    const c = new Connection('ws://x/ws', 0, 0);
    c.connect();
    last().fireOpen();
    last().close();
    expect(c.connected).toBe(false);
    expect(c.status).toBe('reconnecting');

    advance(6000); // past max backoff → a fresh socket is created
    expect(FakeWS.instances.length).toBeGreaterThanOrEqual(2);
    last().fireOpen();
    expect(c.connected).toBe(true);
  });

  it('times out a hung handshake instead of wedging on "connecting"', () => {
    const c = new Connection('ws://x/ws', 0, 0);
    c.connect();
    const first = last();
    advance(8000); // never opened → watchdog closes it
    expect(first.closed).toBe(true);
    advance(6000); // backoff → retry
    expect(FakeWS.instances.length).toBeGreaterThanOrEqual(2);
  });

  it('drops a zombie socket (open but silent) and reconnects', () => {
    const c = new Connection('ws://x/ws', 0, 0);
    c.connect();
    const first = last();
    first.fireOpen();
    expect(c.connected).toBe(true);

    advance(17000); // no frames for > STALE_MS → health check tears it down
    expect(first.closed).toBe(true);
    expect(live().length).toBeGreaterThanOrEqual(1); // a fresh socket exists
    last().fireOpen();
    expect(c.connected).toBe(true);
  });

  it('ignores a superseded socket closing (does not kill the live one)', () => {
    const c = new Connection('ws://x/ws', 0, 0);
    c.connect();
    const first = last();
    first.fireOpen();
    advance(17000); // zombie → first dropped, a new socket opened
    const second = last();
    second.fireOpen();
    expect(c.connected).toBe(true);

    first.onclose?.(); // a late close from the detached socket must be ignored
    expect(c.connected).toBe(true);
  });
});
