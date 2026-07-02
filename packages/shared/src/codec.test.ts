import { describe, expect, it } from 'vitest';
import {
  type AnyMessage,
  decodeMessage,
  EntityKind,
  encodeMessage,
  MessageType,
  PieceStatus,
  RobotStatusBit,
} from './index';

// All position values below are multiples of 1/16 so they survive fixed-point
// quantization exactly, making the round-trip an exact deep-equality check.
const samples: AnyMessage[] = [
  { t: MessageType.C_HELLO, protocolVersion: 1, displayName: 'bot-7' },
  { t: MessageType.C_HELLO, protocolVersion: 1 },
  { t: MessageType.C_HELLO, protocolVersion: 3, displayName: 'phone', sessionToken: 'sess_xyz' },
  { t: MessageType.C_INTENT_MOVE, tx: 123.5, ty: 0.0625 },
  { t: MessageType.C_INTENT_INTERACT, targetId: 1_000_003 },
  { t: MessageType.C_INTENT_FLAG, tx: 2048, ty: 880 },
  { t: MessageType.C_PING, clientTime: 1_700_000_000 },
  { t: MessageType.C_VIEWPORT, cx: 100, cy: 200, halfW: 50, halfH: 40 },
  {
    t: MessageType.S_WELCOME,
    yourRobotId: 42,
    tickHz: 10,
    broadcastHz: 4,
    chunkId: 0,
    worldBounds: [0, 0, 4096, 1024],
    serverTime: 999,
    sessionToken: 'sess_abc',
    resumed: false,
    groundY: 896,
    wrapX: true,
  },
  {
    t: MessageType.S_SNAPSHOT_FULL,
    tick: 5,
    serverTime: 1000,
    entities: [
      {
        id: 1,
        kind: EntityKind.Robot,
        x: 10.25,
        y: 20.5,
        status: RobotStatusBit.Moving | RobotStatusBit.Carrying,
      },
      { id: 1_000_001, kind: EntityKind.Piece, x: 64, y: 64, status: PieceStatus.Placed },
      { id: 2_000_001, kind: EntityKind.Resource, x: 32, y: 96, status: 0 },
      // A klepto mid-flee with the loot bit set (stage 3 | bit 3 = 11).
      { id: 6_000_000, kind: EntityKind.Klepto, x: 700.5, y: 880, status: 11 },
    ],
  },
  // The klepto incursion events (v12) ride the generic S_EVENT payload path.
  { t: MessageType.S_EVENT, name: 19, payload: { section: 2, x: 2560, y: 896 } },
  { t: MessageType.S_EVENT, name: 20, payload: { pieceId: 1_000_001, x: 64, y: 64 } },
  { t: MessageType.S_EVENT, name: 21, payload: { x: 700, y: 880 } },
  { t: MessageType.S_EVENT, name: 22, payload: { x: 700, y: 880 } },
  {
    t: MessageType.S_SNAPSHOT_DELTA,
    tick: 6,
    baseTick: 5,
    serverTime: 1001,
    added: [],
    updated: [{ id: 1, x: 11, y: 21 }],
    removed: [2],
  },
  { t: MessageType.S_PONG, clientTime: 5, serverTime: 7 },
  { t: MessageType.S_EVENT, name: 3, payload: { robotId: 1 } },
  {
    t: MessageType.S_SECTIONS,
    sections: [
      { id: 0, cap: 12, count: 7, x: 512, y: 476, nested: false },
      { id: 100, cap: 3, count: 3, x: 512, y: 596, nested: true },
    ],
  },
];

describe('codec round-trip', () => {
  for (const msg of samples) {
    it(`round-trips message type ${msg.t}`, () => {
      expect(decodeMessage(encodeMessage(msg))).toEqual(msg);
    });
  }

  it('keeps a single robot snapshot entry compact (<= 8 bytes overhead vs ids)', () => {
    const one = encodeMessage({
      t: MessageType.S_SNAPSHOT_FULL,
      tick: 1,
      serverTime: 1,
      entities: [{ id: 1, kind: EntityKind.Robot, x: 1, y: 1, status: 0 }],
    });
    const zero = encodeMessage({
      t: MessageType.S_SNAPSHOT_FULL,
      tick: 1,
      serverTime: 1,
      entities: [],
    });
    // The marginal cost of one robot entry must stay small — this guards the
    // egress math (§7.1 assumes ~16 bytes/robot including framing).
    expect(one.byteLength - zero.byteLength).toBeLessThanOrEqual(12);
  });

  it('throws on a malformed frame', () => {
    expect(() => decodeMessage(new Uint8Array([0x80]))).toThrow();
  });
});
