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
  // Build loop (Phase 1)
  ResourcePickedUp = 10,
  PiecePlaced = 11,
  ContractCompleted = 12,
  // Reserved (slice 2 — two-robot weld, §10): PieceReserved,
  // PieceReservationExpired, PieceProgressed ...
}

/** Payload of DomainEvent.PiecePlaced — carries live contract progress so a
 *  client can update its counter without recounting the world. */
export interface PiecePlacedPayload {
  pieceId: number;
  placed: number;
  total: number;
}
