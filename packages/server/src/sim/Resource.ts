import { EntityKind, type EntitySnapshot } from '@rms/shared';

/**
 * A resource pile / depot a robot grabs material from (§3 build loop). Slice 1
 * models it as an *infinite* depot — picking up never depletes it — so the build
 * loop has no scarcity or respawn logic yet (§9 build-small). Finite,
 * explorable resources are a later refinement.
 */
export class Resource {
  readonly id: number;
  /** Stable, permanent identity (§4.6). */
  readonly stableId: string;
  readonly x: number;
  readonly y: number;
  /** The nested zone (§4.4) this depot serves, or null for a section depot. A vault
   *  depot is reachable/used only inside that chamber; server-internal (not on wire). */
  zoneId: number | null = null;

  constructor(id: number, stableId: string, x: number, y: number) {
    this.id = id;
    this.stableId = stableId;
    this.x = x;
    this.y = y;
  }

  toSnapshot(): EntitySnapshot {
    return { id: this.id, kind: EntityKind.Resource, x: this.x, y: this.y, status: 0 };
  }
}
