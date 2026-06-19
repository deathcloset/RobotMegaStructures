import type { Server as HttpServer } from 'node:http';
import {
  type ClientMessage,
  DomainEvent,
  decodeMessage,
  MessageType,
  PROTOCOL_VERSION,
  type ServerMessage,
} from '@rms/shared';
import { type WebSocket, WebSocketServer } from 'ws';
import type { ServerConfig } from '../config';
import { log } from '../log';
import type { Metrics } from '../metrics/Metrics';
import type { ChunkRegistry } from '../sim/ChunkRegistry';
import { Robot } from '../sim/Robot';
import type { WorldRepo } from '../state/repository';
import { Connection } from './Connection';

/**
 * Owns WebSocket connections: accept, hello/version-check, intent routing, and
 * lifecycle. The §4.7 grace-period/resume logic lands in onClose in Phase 1 —
 * kept in one method so deferring robot removal is a local change.
 */
export class WsGateway {
  private readonly wss: WebSocketServer;
  private readonly connections = new Map<number, Connection>();
  private nextConnId = 1;
  private nextRobotId = 1;

  constructor(
    httpServer: HttpServer,
    private readonly config: ServerConfig,
    private readonly chunks: ChunkRegistry,
    private readonly repo: WorldRepo,
    private readonly metrics: Metrics,
  ) {
    this.wss = new WebSocketServer({ server: httpServer, path: '/ws' });
    this.wss.on('connection', (socket) => this.onConnection(socket));
  }

  get all(): IterableIterator<Connection> {
    return this.connections.values();
  }

  private onConnection(socket: WebSocket): void {
    const id = this.nextConnId++;
    const conn = new Connection(id, socket, this.config.lagMs, this.config.jitterMs, this.metrics);
    this.connections.set(id, conn);
    this.metrics.connections = this.connections.size;

    socket.binaryType = 'nodebuffer';
    socket.on('message', (data: Buffer) => this.onMessage(conn, data));
    socket.on('pong', () => {
      conn.isAlive = true;
    });
    socket.on('close', () => this.onClose(conn));
    socket.on('error', () => this.onClose(conn));
  }

  private onMessage(conn: Connection, data: Buffer): void {
    this.metrics.messagesIn += 1;
    let msg: ClientMessage;
    try {
      msg = decodeMessage(
        new Uint8Array(data.buffer, data.byteOffset, data.byteLength),
      ) as ClientMessage;
    } catch (err) {
      log.warn('bad frame', { conn: conn.id, err: String(err) });
      return;
    }

    const now = Date.now();
    switch (msg.t) {
      case MessageType.C_HELLO:
        this.onHello(conn, msg.protocolVersion, now);
        return;
      case MessageType.C_PING:
        conn.send({ t: MessageType.S_PONG, clientTime: msg.clientTime, serverTime: now }, now);
        return;
      case MessageType.C_VIEWPORT:
        conn.viewCx = msg.cx;
        conn.viewCy = msg.cy;
        conn.viewHalfW = msg.halfW;
        conn.viewHalfH = msg.halfH;
        return;
      case MessageType.C_INTENT_MOVE:
        if (conn.robotId === null) return;
        this.chunks.primary.applyIntent(conn.robotId, msg);
        this.metrics.intentsApplied += 1;
        return;
      default:
        return;
    }
  }

  private onHello(conn: Connection, version: number, now: number): void {
    if (conn.helloOk) return;
    if (version !== PROTOCOL_VERSION) {
      log.warn('protocol mismatch', { conn: conn.id, version, expected: PROTOCOL_VERSION });
      conn.close();
      return;
    }
    conn.helloOk = true;
    const robotId = this.nextRobotId++;
    const chunk = this.chunks.primary;
    const spawnX = chunk.size / 2 + (Math.random() * 2 - 1) * 40;
    const spawnY = chunk.size / 2 + (Math.random() * 2 - 1) * 40;
    const robot = new Robot(robotId, this.repo.nextStableId('robot'), spawnX, spawnY, conn.id);
    chunk.addOccupant(robot);
    conn.robotId = robotId;

    conn.send(
      {
        t: MessageType.S_WELCOME,
        yourRobotId: robotId,
        tickHz: this.config.tickHz,
        broadcastHz: this.config.broadcastHz,
        chunkId: chunk.id,
        worldBounds: [0, 0, chunk.size, chunk.size],
        serverTime: now,
      },
      now,
    );
    log.info('client joined', { conn: conn.id, robotId, conns: this.connections.size });
  }

  private onClose(conn: Connection): void {
    if (!this.connections.has(conn.id)) return;
    this.connections.delete(conn.id);
    this.metrics.connections = this.connections.size;
    // Phase 0: remove the robot immediately. §4.7 grace-period/resume lands here
    // in Phase 1 (defer this via a timer).
    if (conn.robotId !== null) {
      this.chunks.primary.removeOccupant(conn.robotId);
      this.broadcastEvent(DomainEvent.RobotDisconnected, { robotId: conn.robotId });
    }
    log.info('client left', { conn: conn.id, conns: this.connections.size });
  }

  broadcastEvent(name: DomainEvent, payload: unknown): void {
    const now = Date.now();
    const msg: ServerMessage = { t: MessageType.S_EVENT, name, payload };
    for (const conn of this.connections.values()) {
      if (conn.helloOk) conn.send(msg, now);
    }
  }

  /** Heartbeat: terminate sockets that didn't answer the previous ping. */
  heartbeat(): void {
    for (const conn of this.connections.values()) {
      if (!conn.isAlive) {
        conn.socket.terminate();
        continue;
      }
      conn.isAlive = false;
      try {
        conn.socket.ping();
      } catch {
        // socket going away
      }
    }
  }
}
