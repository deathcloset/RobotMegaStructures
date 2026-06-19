/** Entity kinds. Entity-neutral on purpose (§4.6): the chunk/interest/snapshot
 *  pipeline is written against generic entities, so Phase 1+ kinds (pieces,
 *  colonists) cost nothing to add. Encoded as a small int on the wire. */
export enum EntityKind {
  Robot = 0,
  /** Reserved for Phase 1 — build pieces (§6). */
  Piece = 1,
}

export enum RobotStatus {
  Idle = 0,
  Moving = 1,
}

/** Full per-entity state in a snapshot. */
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
