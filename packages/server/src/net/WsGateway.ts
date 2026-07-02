import { randomUUID } from 'node:crypto';
import type { Server as HttpServer } from 'node:http';
import {
  type ClientMessage,
  DomainEvent,
  decodeMessage,
  MessageType,
  PROTOCOL_VERSION,
  type ServerMessage,
  WORLD_WRAP_X,
} from '@rms/shared';
import { type WebSocket, WebSocketServer } from 'ws';
import type { ServerConfig } from '../config';
import { log } from '../log';
import type { Metrics } from '../metrics/Metrics';
import type { ChunkRegistry } from '../sim/ChunkRegistry';
import { Robot } from '../sim/Robot';
import type { WorldRepo } from '../state/repository';
import { Connection } from './Connection';

/** New players spawn by their section's worksite, scattered this far to either
 *  side and in a small band above the surface, so a crowd of joiners doesn't
 *  stack on one pixel. */
const SPAWN_JITTER_X = 80;
const SPAWN_Y_MIN = 24;
const SPAWN_Y_SPAN = 40;

/**
 * Owns WebSocket connections: accept, hello/version-check, intent routing, and
 * lifecycle. Connection resilience (§4.7) lives here: each player robot carries a
 * session token, a dropped owner's robot is *parked* for a grace window rather
 * than deleted, and a reconnect presenting the token resumes the same robot
 * (position + carried item intact). Reconnection is the common case on cheap
 * phones, not an edge case.
 */
export class WsGateway {
  private readonly wss: WebSocketServer;
  private readonly connections = new Map<number, Connection>();
  private nextConnId = 1;
  private nextRobotId = 1;
  // Reconnect bookkeeping (§4.7).
  private readonly sessions = new Map<string, number>(); // token -> robotId
  private readonly robotTokens = new Map<number, string>(); // robotId -> token
  private readonly graceTimers = new Map<number, NodeJS.Timeout>(); // robotId -> removal

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
        this.onHello(conn, msg.protocolVersion, msg.sessionToken, now);
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
      case MessageType.C_INTENT_INTERACT:
      case MessageType.C_INTENT_FLAG:
        if (conn.robotId === null) return;
        // Apply in whichever section currently holds the robot (it may have crossed
        // a boundary since it joined).
        this.chunks.chunkOfRobot(conn.robotId)?.applyIntent(conn.robotId, msg);
        this.metrics.intentsApplied += 1;
        return;
      default:
        return;
    }
  }

  private onHello(conn: Connection, version: number, token: string | undefined, now: number): void {
    if (conn.helloOk) return;
    if (version !== PROTOCOL_VERSION) {
      log.warn('protocol mismatch', { conn: conn.id, version, expected: PROTOCOL_VERSION });
      conn.close();
      return;
    }

    // Resume path (§4.7): a known token whose robot is still around (parked or
    // live) re-binds that robot to this connection instead of spawning anew.
    if (token !== undefined && this.tryResume(conn, token, now)) return;

    // Fresh spawn.
    conn.helloOk = true;
    const robotId = this.nextRobotId++;
    // Spawn into a section with room under the OSHA cap, by its worksite, so new
    // players land looking at a structure rising in front of them.
    const chunk = this.chunks.spawnSection();
    const spawnX = chunk.centerX + (Math.random() * 2 - 1) * SPAWN_JITTER_X;
    const spawnY = chunk.groundY - SPAWN_Y_MIN - Math.random() * SPAWN_Y_SPAN;
    const robot = new Robot(
      robotId,
      this.repo.nextStableId('robot'),
      spawnX,
      spawnY,
      false,
      conn.id,
    );
    chunk.addOccupant(robot);
    conn.robotId = robotId;

    const newToken = randomUUID();
    this.sessions.set(newToken, robotId);
    this.robotTokens.set(robotId, newToken);
    this.sendWelcome(conn, robotId, newToken, false, now);
    log.info('client joined', { conn: conn.id, robotId, conns: this.connections.size });
  }

  /** Re-bind an existing robot to a reconnecting owner. Returns false if the
   *  token is unknown/stale (robot already swept), so the caller spawns fresh. */
  private tryResume(conn: Connection, token: string, now: number): boolean {
    const robotId = this.sessions.get(token);
    if (robotId === undefined) return false;
    const robot = this.chunks.getRobot(robotId);
    if (!robot) {
      this.sessions.delete(token); // stale: robot expired during the grace window
      return false;
    }
    this.cancelGrace(robotId);
    // Claim ownership FIRST, then retire any stale connection still holding this
    // robot — so that connection's (late, async) onClose sees the new owner and
    // no-ops instead of re-parking a robot we've just reclaimed.
    const prevConnId = robot.ownerConnectionId;
    robot.ownerConnectionId = conn.id;
    conn.robotId = robotId;
    conn.helloOk = true;
    if (prevConnId !== null && prevConnId !== conn.id) {
      this.connections.get(prevConnId)?.close();
    }
    this.sendWelcome(conn, robotId, token, true, now);
    this.broadcastEvent(DomainEvent.RobotReconnected, { robotId });
    log.info('client resumed', { conn: conn.id, robotId, conns: this.connections.size });
    return true;
  }

  private sendWelcome(
    conn: Connection,
    robotId: number,
    token: string,
    resumed: boolean,
    now: number,
  ): void {
    const chunk = this.chunks.primary;
    conn.send(
      {
        t: MessageType.S_WELCOME,
        yourRobotId: robotId,
        tickHz: this.config.tickHz,
        broadcastHz: this.config.broadcastHz,
        chunkId: this.chunks.chunkOfRobot(robotId)?.id ?? chunk.id,
        worldBounds: [0, 0, chunk.width, chunk.height],
        groundY: chunk.groundY,
        wrapX: WORLD_WRAP_X,
        serverTime: now,
        sessionToken: token,
        resumed,
      },
      now,
    );
  }

  private onClose(conn: Connection): void {
    if (!this.connections.has(conn.id)) return;
    this.connections.delete(conn.id);
    this.metrics.connections = this.connections.size;
    // §4.7 grace: don't vanish the robot. Park it (idle, still visible, carried
    // item kept) and schedule removal; a reconnect within the window resumes it.
    if (conn.robotId !== null) {
      const robot = this.chunks.getRobot(conn.robotId);
      if (robot && robot.ownerConnectionId === conn.id) {
        robot.ownerConnectionId = null;
        robot.pendingAction = null;
        robot.halt();
        const robotId = conn.robotId;
        this.cancelGrace(robotId);
        this.graceTimers.set(
          robotId,
          setTimeout(() => this.finalizeRemoval(robotId), this.config.gracePeriodMs),
        );
      }
    }
    log.info('client left', { conn: conn.id, conns: this.connections.size });
  }

  /** Grace window elapsed without a reconnect — remove the parked robot for good. */
  private finalizeRemoval(robotId: number): void {
    this.graceTimers.delete(robotId);
    const robot = this.chunks.getRobot(robotId);
    if (robot?.parked) {
      this.chunks.removeRobot(robotId);
      this.broadcastEvent(DomainEvent.RobotDisconnected, { robotId });
      log.info('robot grace expired', { robotId });
    }
    const token = this.robotTokens.get(robotId);
    if (token !== undefined) {
      this.sessions.delete(token);
      this.robotTokens.delete(robotId);
    }
  }

  private cancelGrace(robotId: number): void {
    const timer = this.graceTimers.get(robotId);
    if (timer) {
      clearTimeout(timer);
      this.graceTimers.delete(robotId);
    }
  }

  broadcastEvent(name: DomainEvent, payload: unknown): void {
    const now = Date.now();
    const msg: ServerMessage = { t: MessageType.S_EVENT, name, payload };
    for (const conn of this.connections.values()) {
      if (conn.helloOk) conn.send(msg, now);
    }
  }

  /** Send a domain event to one connection (e.g. a personal checkpoint nudge). */
  sendEventTo(connId: number, name: DomainEvent, payload: unknown): void {
    const conn = this.connections.get(connId);
    if (conn?.helloOk) conn.send({ t: MessageType.S_EVENT, name, payload }, Date.now());
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
