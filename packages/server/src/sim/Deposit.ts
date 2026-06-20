import { DEPOSIT_MAX, DEPOSIT_REGEN_PER_SEC, EntityKind, type EntitySnapshot } from '@rms/shared';

/**
 * An ore deposit on the planet surface (§ Phase 2 surface mining). A *renewable*
 * vein, unlike the infinite starter depots (`Resource`): mining extracts a load
 * and drops its richness; between visits it slowly refills, so heavy use depletes
 * a vein but the planet never runs dry. Static position; only its `amount`
 * changes. The wire carries `amount` (rounded) as `status` so the client can show
 * how full the vein is.
 */
export class Deposit {
  readonly id: number;
  /** Stable, permanent identity (§4.6). */
  readonly stableId: string;
  readonly x: number;
  readonly y: number;
  /** Current loads available (0..DEPOSIT_MAX). */
  amount: number;

  constructor(id: number, stableId: string, x: number, y: number, amount = DEPOSIT_MAX) {
    this.id = id;
    this.stableId = stableId;
    this.x = x;
    this.y = y;
    this.amount = amount;
  }

  /** Slowly refill the vein (called each tick). */
  regen(dt: number): void {
    if (this.amount < DEPOSIT_MAX) {
      this.amount = Math.min(DEPOSIT_MAX, this.amount + DEPOSIT_REGEN_PER_SEC * dt);
    }
  }

  /** Extract one load if the vein has any; returns whether it succeeded. */
  extract(): boolean {
    if (this.amount >= 1) {
      this.amount -= 1;
      return true;
    }
    return false;
  }

  toSnapshot(): EntitySnapshot {
    return {
      id: this.id,
      kind: EntityKind.Deposit,
      x: this.x,
      y: this.y,
      status: Math.round(this.amount),
    };
  }
}
