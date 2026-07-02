/**
 * The domain-event catalogue (§6) — a first-class, named stream from day one,
 * and the seam future modes subscribe to instead of reaching into state.
 * Phase 0 emitted only the presence subset; Phase 1 adds the build loop.
 */
export enum DomainEvent {
  // Movement / presence (Phase 0)
  RobotEnteredChunk = 1,
  RobotLeftChunk = 2,
  RobotDisconnected = 3,
  RobotReconnected = 4,
  // Build loop (Phase 1)
  ResourcePickedUp = 10,
  PiecePlaced = 11,
  ContractCompleted = 12,
  ContractStarted = 13,
  // Two-robot weld (Phase 1, §10)
  PieceReserved = 14,
  PieceReleased = 15,
  // Chunks / checkpoints (Phase 2, §4.4)
  /** Sent to a player held at a section checkpoint because the section is at its
   *  OSHA cap — the queue-when-full backpressure. */
  SectionFull = 16,
  // Flavor (Phase 2) — language-neutral delight (pillar #1: no reading required)
  /** A robot pops an emoji over its head at a work milestone (server-picked,
   *  cooldown/probability-gated so it stays sparse). */
  RobotEmote = 17,
  /** A nested vault's interior contract just completed (the start of its rebuild
   *  beat) — the client celebrates at the chamber. */
  VaultCompleted = 18,
  // Klepto incursion (Phase 3 §3 — the first slapstick system)
  /** A klepto landed in a section — the shared-threat klaxon (deliberately global). */
  KleptoLanded = 19,
  /** It pried off a placed piece and is fleeing with it. */
  KleptoStole = 20,
  /** Two robots cornered it — the piece is restored and the klepto beamed away
   *  (captured, never killed; mischief, not malice). */
  KleptoCaptured = 21,
  /** Nobody caught it — it beamed out (with the part, or empty-handed). The crew
   *  rebuilds through the ordinary contract loop; nothing else changes. */
  KleptoEscaped = 22,
}

/** Payload of DomainEvent.PiecePlaced — carries live contract progress so a
 *  client can update its counter without recounting the world. */
export interface PiecePlacedPayload {
  pieceId: number;
  placed: number;
  total: number;
}

/** Payload of DomainEvent.RobotEmote — which robot, and the emoji it pops.
 *  Emoji only, never words: the game must read the same in every language (§2
 *  pillar #1 accessibility). */
export interface RobotEmotePayload {
  robotId: number;
  e: string;
}

/** Payload of DomainEvent.VaultCompleted — the chamber's id + world anchor, so
 *  the client can celebrate there without knowing zone geometry. */
export interface VaultCompletedPayload {
  zoneId: number;
  x: number;
  y: number;
}

/** Payload of DomainEvent.KleptoLanded — which section (for the banner's zone
 *  number) and where the critter touches down. */
export interface KleptoLandedPayload {
  section: number;
  x: number;
  y: number;
}

/** Payload of DomainEvent.KleptoStole. `pieceId` is deliberately on the wire:
 *  when identity ships, "a klepto stole 🦾🌟-7's girder" is a one-liner (the
 *  victim-attribution seam). */
export interface KleptoStolePayload {
  pieceId: number;
  x: number;
  y: number;
}

/** Payload of DomainEvent.KleptoCaptured — the celebration anchor (like
 *  VaultCompleted). */
export interface KleptoCapturedPayload {
  x: number;
  y: number;
}

/** Payload of DomainEvent.KleptoEscaped — where it beamed out. */
export interface KleptoEscapedPayload {
  x: number;
  y: number;
}
