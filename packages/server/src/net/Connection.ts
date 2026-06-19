import { type AnyMessage, encodeMessage } from '@rms/shared';
import { WebSocket } from 'ws';
import type { Metrics } from '../metrics/Metrics';

interface DelayedFrame {
  sendAt: number;
  bytes: Uint8Array;
}

/**
 * One connected client. Owns the outbound lag-injection queue (§4.7/§7.4) so we
 * can reproduce the ~1s-lag feel test without touching the network, and the
 * delta-mode "last sent" baseline.
 */
export class Connection {
  readonly id: number;
  readonly socket: WebSocket;
  robotId: number | null = null;
  helloOk = false;
  isAlive = true;

  // Viewport (world units); defaults to "see everything" until the client reports.
  viewCx = 0;
  viewCy = 0;
  viewHalfW = Number.POSITIVE_INFINITY;
  viewHalfH = Number.POSITIVE_INFINITY;

  // Delta-mode baseline: last entity positions we sent this client.
  readonly lastSent = new Map<number, { x: number; y: number }>();
  lastKeyframeAt = 0;
  lastTickSent = 0;

  private readonly outQueue: DelayedFrame[] = [];
  private readonly lagMs: number;
  private readonly jitterMs: number;
  private readonly metrics: Metrics;

  constructor(id: number, socket: WebSocket, lagMs: number, jitterMs: number, metrics: Metrics) {
    this.id = id;
    this.socket = socket;
    this.lagMs = lagMs;
    this.jitterMs = jitterMs;
    this.metrics = metrics;
  }

  /** Encode + queue/flush a typed message (welcome, pong, events). */
  send(msg: AnyMessage, now: number): void {
    this.enqueue(encodeMessage(msg), now);
  }

  /** Queue/flush a pre-encoded frame (snapshots — encoded once for metrics). */
  sendBytes(bytes: Uint8Array, now: number): void {
    this.enqueue(bytes, now);
  }

  private enqueue(bytes: Uint8Array, now: number): void {
    if (this.lagMs <= 0 && this.jitterMs <= 0) {
      this.flushFrame(bytes);
      return;
    }
    const jitter = this.jitterMs > 0 ? (Math.random() * 2 - 1) * this.jitterMs : 0;
    this.outQueue.push({ sendAt: now + this.lagMs + jitter, bytes });
  }

  /** Send any queued frames whose delay has elapsed (order-preserving). */
  drain(now: number): void {
    while (this.outQueue.length > 0 && this.outQueue[0]!.sendAt <= now) {
      this.flushFrame(this.outQueue.shift()!.bytes);
    }
  }

  private flushFrame(bytes: Uint8Array): void {
    if (this.socket.readyState !== WebSocket.OPEN) return;
    this.socket.send(bytes);
    this.metrics.recordEgress(bytes.byteLength);
  }

  close(): void {
    try {
      this.socket.close();
    } catch {
      // already closed
    }
  }
}
