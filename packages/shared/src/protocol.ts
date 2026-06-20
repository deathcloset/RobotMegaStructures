import type { EntityDelta, EntitySnapshot } from './entities';
import type { DomainEvent } from './events';

/**
 * Every wire frame is a MessagePack-encoded positional array `[type, ...fields]`.
 * Positional arrays beat keyed maps: no repeated field-name strings per message,
 * which matters directly for the egress north-star (§7.2). Numeric message types
 * keep the discriminator to a single byte.
 */
export enum MessageType {
  // Client -> Server
  C_HELLO = 1,
  C_INTENT_MOVE = 2,
  C_PING = 3,
  C_VIEWPORT = 4,
  C_INTENT_INTERACT = 5,
  // Server -> Client
  S_WELCOME = 10,
  S_SNAPSHOT_FULL = 11,
  S_SNAPSHOT_DELTA = 12,
  S_PONG = 13,
  S_EVENT = 14,
}

export interface CHello {
  t: MessageType.C_HELLO;
  protocolVersion: number;
  displayName?: string;
  /** A prior session token (§4.7): if it still maps to a parked robot the server
   *  resumes it (same id, position, carried item) instead of spawning fresh. */
  sessionToken?: string;
}
/** "Move toward this world point." */
export interface CIntentMove {
  t: MessageType.C_INTENT_MOVE;
  tx: number;
  ty: number;
}
/**
 * "Act on this entity." The server decides pickup vs deliver from context
 * (is the robot carrying? is the target a depot or a ghost piece?) — the client
 * never asserts the outcome (§4.2). Walking to range happens server-side.
 */
export interface CIntentInteract {
  t: MessageType.C_INTENT_INTERACT;
  targetId: number;
}
export interface CPing {
  t: MessageType.C_PING;
  clientTime: number;
}
/** Client's current view rect (world units) — feeds server AOI (§4.3). */
export interface CViewport {
  t: MessageType.C_VIEWPORT;
  cx: number;
  cy: number;
  halfW: number;
  halfH: number;
}

export type WorldBounds = readonly [x0: number, y0: number, x1: number, y1: number];

export interface SWelcome {
  t: MessageType.S_WELCOME;
  yourRobotId: number;
  tickHz: number;
  broadcastHz: number;
  chunkId: number;
  /** [x0, y0, x1, y1] — now a wide rectangle, not a square (§ Phase 2). */
  worldBounds: WorldBounds;
  /** Surface line (world Y): sky above, ground below; the structure rises from it. */
  groundY: number;
  /** The X axis wraps (cylinder): the client renders the seam seamlessly and the
   *  camera loops. */
  wrapX: boolean;
  serverTime: number;
  /** Token to present on a later reconnect to resume this robot (§4.7). Also
   *  signals whether this welcome was a fresh spawn or a resume (see `resumed`). */
  sessionToken: string;
  /** True when the server matched a presented token and resumed an existing
   *  robot rather than spawning a new one — lets the client skip re-centering. */
  resumed: boolean;
}
export interface SSnapshotFull {
  t: MessageType.S_SNAPSHOT_FULL;
  tick: number;
  serverTime: number;
  entities: EntitySnapshot[];
}
export interface SSnapshotDelta {
  t: MessageType.S_SNAPSHOT_DELTA;
  tick: number;
  baseTick: number;
  serverTime: number;
  added: EntitySnapshot[];
  updated: EntityDelta[];
  removed: number[];
}
export interface SPong {
  t: MessageType.S_PONG;
  clientTime: number;
  serverTime: number;
}
export interface SEvent {
  t: MessageType.S_EVENT;
  name: DomainEvent;
  payload?: unknown;
}

export type ClientMessage = CHello | CIntentMove | CPing | CViewport | CIntentInteract;
export type ServerMessage = SWelcome | SSnapshotFull | SSnapshotDelta | SPong | SEvent;
export type AnyMessage = ClientMessage | ServerMessage;
