import { Decoder, Encoder } from '@msgpack/msgpack';
import type { EntityDelta, EntitySnapshot } from './entities';
import { fromFixed16, toFixed16 } from './fixedpoint';
import { type AnyMessage, MessageType, type WorldBounds } from './protocol';

// Reuse encoder/decoder instances — avoids per-call allocation at 4 Hz x N clients.
const encoder = new Encoder();
const decoder = new Decoder();

/** Low-level MessagePack encode. Returns a COPY so queued frames (lag injection)
 *  stay valid after the next encode reuses the scratch buffer. The copy is
 *  ArrayBuffer-backed, which the browser WebSocket.send signature requires. */
export function encode(value: unknown): Uint8Array<ArrayBuffer> {
  return encoder.encode(value).slice();
}

export function decode(bytes: Uint8Array): unknown {
  return decoder.decode(bytes);
}

function entityToWire(e: EntitySnapshot): [number, number, number, number, number] {
  return [e.id, e.kind, toFixed16(e.x), toFixed16(e.y), e.status];
}
function entityFromWire(a: readonly number[]): EntitySnapshot {
  return { id: a[0]!, kind: a[1]!, x: fromFixed16(a[2]!), y: fromFixed16(a[3]!), status: a[4]! };
}
function deltaToWire(e: EntityDelta): [number, number, number] {
  return [e.id, toFixed16(e.x), toFixed16(e.y)];
}
function deltaFromWire(a: readonly number[]): EntityDelta {
  return { id: a[0]!, x: fromFixed16(a[1]!), y: fromFixed16(a[2]!) };
}

/** Encode a typed message to a MessagePack frame. */
export function encodeMessage(msg: AnyMessage): Uint8Array<ArrayBuffer> {
  return encode(toWire(msg));
}

function toWire(msg: AnyMessage): unknown[] {
  switch (msg.t) {
    case MessageType.C_HELLO:
      return [msg.t, msg.protocolVersion, msg.displayName ?? null];
    case MessageType.C_INTENT_MOVE:
      return [msg.t, toFixed16(msg.tx), toFixed16(msg.ty)];
    case MessageType.C_PING:
      return [msg.t, msg.clientTime];
    case MessageType.C_VIEWPORT:
      return [
        msg.t,
        toFixed16(msg.cx),
        toFixed16(msg.cy),
        toFixed16(msg.halfW),
        toFixed16(msg.halfH),
      ];
    case MessageType.S_WELCOME:
      return [
        msg.t,
        msg.yourRobotId,
        msg.tickHz,
        msg.broadcastHz,
        msg.chunkId,
        msg.worldBounds.map(toFixed16),
        msg.serverTime,
      ];
    case MessageType.S_SNAPSHOT_FULL:
      return [msg.t, msg.tick, msg.serverTime, msg.entities.map(entityToWire)];
    case MessageType.S_SNAPSHOT_DELTA:
      return [
        msg.t,
        msg.tick,
        msg.baseTick,
        msg.serverTime,
        msg.added.map(entityToWire),
        msg.updated.map(deltaToWire),
        msg.removed,
      ];
    case MessageType.S_PONG:
      return [msg.t, msg.clientTime, msg.serverTime];
    case MessageType.S_EVENT:
      return [msg.t, msg.name, msg.payload ?? null];
  }
}

/** Decode a MessagePack frame into a typed message. Throws on malformed input. */
export function decodeMessage(bytes: Uint8Array): AnyMessage {
  const a = decode(bytes);
  if (!Array.isArray(a) || a.length === 0) {
    throw new Error('malformed frame: expected a non-empty array');
  }
  const t = a[0] as MessageType;
  switch (t) {
    case MessageType.C_HELLO:
      return { t, protocolVersion: a[1], displayName: a[2] ?? undefined };
    case MessageType.C_INTENT_MOVE:
      return { t, tx: fromFixed16(a[1]), ty: fromFixed16(a[2]) };
    case MessageType.C_PING:
      return { t, clientTime: a[1] };
    case MessageType.C_VIEWPORT:
      return {
        t,
        cx: fromFixed16(a[1]),
        cy: fromFixed16(a[2]),
        halfW: fromFixed16(a[3]),
        halfH: fromFixed16(a[4]),
      };
    case MessageType.S_WELCOME:
      return {
        t,
        yourRobotId: a[1],
        tickHz: a[2],
        broadcastHz: a[3],
        chunkId: a[4],
        worldBounds: (a[5] as number[]).map(fromFixed16) as unknown as WorldBounds,
        serverTime: a[6],
      };
    case MessageType.S_SNAPSHOT_FULL:
      return {
        t,
        tick: a[1],
        serverTime: a[2],
        entities: (a[3] as number[][]).map(entityFromWire),
      };
    case MessageType.S_SNAPSHOT_DELTA:
      return {
        t,
        tick: a[1],
        baseTick: a[2],
        serverTime: a[3],
        added: (a[4] as number[][]).map(entityFromWire),
        updated: (a[5] as number[][]).map(deltaFromWire),
        removed: a[6] as number[],
      };
    case MessageType.S_PONG:
      return { t, clientTime: a[1], serverTime: a[2] };
    case MessageType.S_EVENT:
      return { t, name: a[1], payload: a[2] ?? undefined };
    default:
      throw new Error(`unknown message type: ${String(t)}`);
  }
}
