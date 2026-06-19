/**
 * The domain-event catalogue (§6) — a first-class, named stream from day one,
 * and the seam future modes subscribe to instead of reaching into state.
 * Phase 0 emits only the presence subset; the rest are reserved.
 */
export enum DomainEvent {
  RobotEnteredChunk = 1,
  RobotLeftChunk = 2,
  RobotDisconnected = 3,
  // Reserved (Phase 1+): piece.reserved, piece.placed, chunk.completed, cert.* ...
}
