/** Entity kinds. Entity-neutral on purpose (§4.6): the chunk/interest/snapshot
 *  pipeline is written against generic entities, so new kinds cost nothing to
 *  add. Encoded as a small int on the wire. */
export enum EntityKind {
  Robot = 0,
  /** A build piece — the structure being assembled (§3, §6). */
  Piece = 1,
  /** A resource pile / depot a robot grabs material from (§3 build loop). */
  Resource = 2,
  /** A two-robot weld piece — needs a holder + a welder to place (§10). Same
   *  PieceStatus state machine, rendered distinctly so players know it needs a
   *  partner. */
  WeldPiece = 3,
  /** An ore deposit on the planet surface — mine it for material (§ Phase 2).
   *  A renewable vein: `status` carries its remaining richness (0..DEPOSIT_MAX)
   *  so the client can show how full it is. The reason to roam the wide world;
   *  depots are the convenient starter, veins are the wider story. */
  Deposit = 4,
  /** A player's work-flag (§ Phase 2 crews). Planted to rally the builder crew to
   *  work that area; `status` carries the owner's robot id so a client can tell its
   *  own flag from others'. */
  Flag = 5,
}

/**
 * Robot status is a small bitfield, not an enum of distinct states, so "carrying"
 * rides alongside motion in the single `status` int the snapshot already carries —
 * EntitySnapshot stays 5 ints and the egress north-star (§7.2) is untouched.
 */
export enum RobotStatusBit {
  /** bit 0 — in transit toward a target vs parked. */
  Moving = 1,
  /** bit 1 — hauling a resource toward a ghost piece. */
  Carrying = 2,
}

/**
 * Piece assembly state machine (§4.2, §10). A normal piece goes Ghost → Placed on
 * a single delivery. A weld piece goes Ghost → Reserved (a holder arrived with
 * the beam, awaiting a partner) → InProgress (welder joined, welding) → Placed;
 * any drop/TTL releases it back to Ghost. Encoded as the entity `status`.
 */
export enum PieceStatus {
  Ghost = 0,
  Reserved = 1,
  InProgress = 2,
  Placed = 3,
}

/** Full per-entity state in a snapshot. `status` is interpreted per `kind`
 *  (robot: RobotStatusBit bitfield; piece: PieceStatus; resource: unused). */
export interface EntitySnapshot {
  id: number;
  kind: EntityKind;
  x: number;
  y: number;
  status: number;
}

/** Position-only delta entry (the compact hot-path shape). */
export interface EntityDelta {
  id: number;
  x: number;
  y: number;
}
