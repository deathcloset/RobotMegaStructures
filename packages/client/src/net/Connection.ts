import { type AnyMessage, decodeMessage, encodeMessage } from '@rms/shared';

interface Delayed {
  at: number;
  msg: AnyMessage;
}

/** Browser WebSocket wrapper with optional INBOUND lag injection (?lag=&jitter=)
 *  so the ~1s-lag feel can be tested against a clean local server. */
export class Connection {
  private ws: WebSocket | null = null;
  private readonly inbox: Delayed[] = [];
  bytesIn = 0;

  onMessage: (msg: AnyMessage) => void = () => {};
  onOpen: () => void = () => {};

  constructor(
    private readonly url: string,
    private readonly lagMs: number,
    private readonly jitterMs: number,
  ) {}

  connect(): void {
    const ws = new WebSocket(this.url);
    ws.binaryType = 'arraybuffer';
    ws.onopen = () => this.onOpen();
    ws.onmessage = (ev) => {
      const bytes = new Uint8Array(ev.data as ArrayBuffer);
      this.bytesIn += bytes.byteLength;
      const msg = decodeMessage(bytes);
      if (this.lagMs <= 0 && this.jitterMs <= 0) {
        this.onMessage(msg);
      } else {
        const jitter = this.jitterMs > 0 ? Math.random() * this.jitterMs : 0;
        this.inbox.push({ at: performance.now() + this.lagMs + jitter, msg });
      }
    };
    ws.onclose = () => {
      this.ws = null;
    };
    this.ws = ws;
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
}
