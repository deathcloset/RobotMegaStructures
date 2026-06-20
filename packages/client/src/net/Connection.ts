import { type AnyMessage, decodeMessage, encodeMessage } from '@rms/shared';

interface Delayed {
  at: number;
  msg: AnyMessage;
}

export type ConnStatus = 'connecting' | 'open' | 'reconnecting' | 'closed';

/** A handshake that doesn't open within this is treated as hung and retried —
 *  flaky mobile networks can leave a connect attempt pending forever. */
const CONNECT_TIMEOUT_MS = 8000;
/** "Open" but no frame for this long ⇒ a zombie socket (a frozen mobile tab can
 *  keep readyState OPEN on a dead connection). The server broadcasts continuously
 *  at ~4 Hz, so real silence this long means the link is gone — reconnect. */
const STALE_MS = 12_000;
/** Cadence of the zombie-socket check. */
const HEALTH_EVERY_MS = 4000;

/**
 * Browser WebSocket wrapper with resilient auto-reconnect (§4.7 — drops are the
 * common case on cheap phones) and optional INBOUND lag injection (?lag=&jitter=)
 * so the ~1s-lag feel can be tested against a clean local server. On reopen the
 * caller re-sends C_HELLO (with its saved session token) to resume its robot.
 */
export class Connection {
  private ws: WebSocket | null = null;
  private readonly inbox: Delayed[] = [];
  private shouldRun = false;
  private attempt = 0;
  private reconnectTimer = 0;
  private connectTimer = 0;
  private healthTimer = 0;
  private lastRecvAt = 0;
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
    // Catch zombie sockets even when no visibility/online event fires.
    clearInterval(this.healthTimer);
    this.healthTimer = window.setInterval(() => this.checkHealth(), HEALTH_EVERY_MS);
  }

  private open(): void {
    if (this.ws) return;
    this.setStatus(this.attempt === 0 ? 'connecting' : 'reconnecting');
    const ws = new WebSocket(this.url);
    ws.binaryType = 'arraybuffer';
    this.ws = ws;

    // A hung handshake must not wedge us in 'connecting' forever.
    clearTimeout(this.connectTimer);
    this.connectTimer = window.setTimeout(() => {
      if (this.ws === ws && ws.readyState !== WebSocket.OPEN) this.closeSocket(ws);
    }, CONNECT_TIMEOUT_MS);

    // Each handler ignores events from a socket we've already moved on from, so a
    // late close/message from a stale socket can't clobber the live one.
    ws.onopen = () => {
      if (this.ws !== ws) return;
      clearTimeout(this.connectTimer);
      this.attempt = 0;
      this.lastRecvAt = performance.now();
      this.setStatus('open');
      this.onOpen();
    };
    ws.onmessage = (ev) => {
      if (this.ws !== ws) return;
      this.lastRecvAt = performance.now();
      this.receive(ev.data as ArrayBuffer);
    };
    ws.onclose = () => {
      if (this.ws !== ws) return;
      clearTimeout(this.connectTimer);
      this.ws = null;
      if (this.shouldRun) this.scheduleReconnect();
      else this.setStatus('closed');
    };
    ws.onerror = () => this.closeSocket(ws);
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
   *  user tapped "retry". Also tears down a zombie socket first. */
  ensureConnected(): void {
    if (!this.shouldRun) return;
    if (this.isZombie()) this.dropSocket();
    if (this.connected || this.ws) return;
    clearTimeout(this.reconnectTimer);
    this.attempt = 0;
    this.open();
  }

  private checkHealth(): void {
    if (this.isZombie()) {
      this.dropSocket();
      this.ensureConnected();
    }
  }

  private isZombie(): boolean {
    return this.connected && performance.now() - this.lastRecvAt > STALE_MS;
  }

  /** Detach + close the current socket so its (now-ignored) onclose can't drive a
   *  competing reconnect; the caller reopens. */
  private dropSocket(): void {
    const ws = this.ws;
    this.ws = null;
    if (ws) this.closeSocket(ws);
  }

  private closeSocket(ws: WebSocket): void {
    try {
      ws.close();
    } catch {
      // already closing
    }
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
