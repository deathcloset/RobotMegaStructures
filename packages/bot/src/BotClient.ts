import {
  type AnyMessage,
  decodeMessage,
  encodeMessage,
  MessageType,
  PROTOCOL_VERSION,
  WORLD_SIZE,
} from '@rms/shared';
import { WebSocket } from 'ws';

export interface BotStats {
  connected: boolean;
  bytesIn: number;
  snapshots: number;
  errors: number;
}

/**
 * One headless client: connects, walks randomly, and decodes every inbound frame
 * (exercising the real shared codec). Bots intentionally do NOT report a
 * viewport, so they receive the whole chunk — the honest worst-case fan-out for
 * Phase 0's single-chunk egress measurement.
 */
export class BotClient {
  private ws: WebSocket | null = null;
  readonly stats: BotStats = { connected: false, bytesIn: 0, snapshots: 0, errors: 0 };
  private robotId: number | null = null;
  private moveTimer: NodeJS.Timeout | null = null;
  private targetX = Math.random() * WORLD_SIZE;
  private targetY = Math.random() * WORLD_SIZE;

  constructor(
    private readonly url: string,
    private readonly rateHz: number,
  ) {}

  start(): void {
    const ws = new WebSocket(this.url);
    ws.binaryType = 'nodebuffer';
    ws.on('open', () => {
      this.stats.connected = true;
      this.sendRaw({
        t: MessageType.C_HELLO,
        protocolVersion: PROTOCOL_VERSION,
        displayName: 'bot',
      });
      this.moveTimer = setInterval(
        () => this.tickMove(),
        Math.max(1, Math.round(1000 / this.rateHz)),
      );
    });
    ws.on('message', (data: Buffer) => this.onMessage(data));
    ws.on('error', () => {
      this.stats.errors += 1;
    });
    ws.on('close', () => {
      this.stats.connected = false;
      if (this.moveTimer) clearInterval(this.moveTimer);
    });
    this.ws = ws;
  }

  private onMessage(data: Buffer): void {
    this.stats.bytesIn += data.byteLength;
    let msg: AnyMessage;
    try {
      msg = decodeMessage(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
    } catch {
      this.stats.errors += 1;
      return;
    }
    if (msg.t === MessageType.S_WELCOME) {
      this.robotId = msg.yourRobotId;
    } else if (msg.t === MessageType.S_SNAPSHOT_FULL || msg.t === MessageType.S_SNAPSHOT_DELTA) {
      this.stats.snapshots += 1;
    }
  }

  private tickMove(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN || this.robotId === null) return;
    if (Math.random() < 0.25) {
      this.targetX = Math.random() * WORLD_SIZE;
      this.targetY = Math.random() * WORLD_SIZE;
    }
    this.sendRaw({ t: MessageType.C_INTENT_MOVE, tx: this.targetX, ty: this.targetY });
  }

  private sendRaw(msg: AnyMessage): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(encodeMessage(msg));
  }

  stop(): void {
    if (this.moveTimer) clearInterval(this.moveTimer);
    this.ws?.close();
  }
}
