import { type AnyMessage, decodeMessage, encodeMessage } from '@rms/shared';

interface Delayed {
  at: number;
  msg: AnyMessage;
}

export type ConnStatus = 'connecting' | 'open' | 'reconnecting' | 'closed';

/**
 * Browser WebSocket wrapper with auto-reconnect (§4.7 — drops are the common case
 * on cheap phones) and optional INBOUND lag injection (?lag=&jitter=) so the
 * ~1s-lag feel can be tested against a clean local server. On reopen the caller
 * re-sends C_HELLO (with its saved session token) to resume its robot.
 */
export class Connection {
  private ws: WebSocket | null = null;
  private readonly inbox: Delayed[] = [];
  private shouldRun = false;
  private attempt = 0;
  private reconnectTimer = 0;
  bytesIn = 0;
  status: ConnStatus = 'connecting';

  onMessage: (msg: AnyMessage) => void = () => {};
  onOpen: () => void = () => {};
  onStatus: (s: ConnStatus) => void = () => {};

  constructor(
    private readonly url: string,
    private readonly lagMs: number,
    private readonly jitterMs: number,
  ) {}

  connect(): void {
    this.shouldRun = true;
    this.open();
  }

  private open(): void {
    if (this.ws) return;
    this.setStatus(this.attempt === 0 ? 'connecting' : 'reconnecting');
    const ws = new WebSocket(this.url);
    ws.binaryType = 'arraybuffer';
    ws.onopen = () => {
      this.attempt = 0;
      this.setStatus('open');
      this.onOpen();
    };
    ws.onmessage = (ev) => this.receive(ev.data as ArrayBuffer);
    ws.onclose = () => {
      this.ws = null;
      if (this.shouldRun) this.scheduleReconnect();
      else this.setStatus('closed');
    };
    ws.onerror = () => {
      try {
        ws.close();
      } catch {
        // already closing
      }
    };
    this.ws = ws;
  }

  private receive(data: ArrayBuffer): void {
    const bytes = new Uint8Array(data);
    this.bytesIn += bytes.byteLength;
    let msg: AnyMessage;
    try {
      msg = decodeMessage(bytes);
    } catch {
      return; // ignore a malformed frame rather than break the socket loop
    }
    if (this.lagMs <= 0 && this.jitterMs <= 0) {
      this.onMessage(msg);
    } else {
      const jitter = this.jitterMs > 0 ? Math.random() * this.jitterMs : 0;
      this.inbox.push({ at: performance.now() + this.lagMs + jitter, msg });
    }
  }

  private scheduleReconnect(): void {
    this.setStatus('reconnecting');
    const backoff = Math.min(5000, 500 * 2 ** this.attempt) + Math.random() * 250;
    this.attempt += 1;
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = window.setTimeout(() => this.open(), backoff);
  }

  /** Nudge an immediate reconnect — tab became visible, network returned, or the
   *  user tapped "retry". No-op if already connected. */
  ensureConnected(): void {
    if (!this.shouldRun || this.connected || this.ws) return;
    clearTimeout(this.reconnectTimer);
    this.attempt = 0;
    this.open();
  }

  /** Pump delayed inbound messages; call once per frame. Order-preserving. */
  pump(nowMs: number): void {
    while (this.inbox.length > 0 && this.inbox[0]!.at <= nowMs) {
      this.onMessage(this.inbox.shift()!.msg);
    }
  }

  send(msg: AnyMessage): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(encodeMessage(msg));
  }

  get connected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }

  private setStatus(s: ConnStatus): void {
    if (s !== this.status) {
      this.status = s;
      this.onStatus(s);
    }
  }
}
