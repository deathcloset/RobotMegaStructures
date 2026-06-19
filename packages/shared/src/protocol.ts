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
}
/** "Move toward this world point." The only gameplay intent in Phase 0. */
export interface CIntentMove {
  t: MessageType.C_INTENT_MOVE;
  tx: number;
  ty: number;
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
  worldBounds: WorldBounds;
  serverTime: number;
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

export type ClientMessage = CHello | CIntentMove | CPing | CViewport;
export type ServerMessage = SWelcome | SSnapshotFull | SSnapshotDelta | SPong | SEvent;
export type AnyMessage = ClientMessage | ServerMessage;
