import { EntityKind, type EntitySnapshot, KLEPTO_LOOT_BIT, KleptoStage } from '@rms/shared';
import { advanceToward } from './movement';

/**
 * A klepto alien (§3 — Phase 3's first slapstick system): drops out of the sky,
 * brazenly pries a placed piece off the structure, and flees in taunting
 * dash-and-pause zig-zags. Corner it with TWO robots to capture it (captured,
 * never killed) and the piece pops back; catch nobody and it beams away with the
 * part — the crew simply rebuilds through the untouched contract loop.
 *
 * NOT a Robot on purpose: it never enters `Chunk.robots`, so it doesn't count
 * against the OSHA cap, is invisible to `ChunkRegistry.settle()`, holds no zone
 * slot, and can't be handed off. It's a chunk-owned entity that happens to move
 * (the Gate/vault precedent). This file holds the entity + every klepto tunable;
 * all mutations of chunk state happen in `Chunk.advanceKlepto` — the entity holds
 * state, the Chunk actor owns transitions (the Piece/advanceWelds split).
 *
 * Designed to be impossible to deadlock (§4.7): the klepto holds no robot
 * references across ticks, no robot holds klepto engagement state (chasing is
 * `setTarget` only), capture is recomputed fresh from positions each tick, and
 * `lifeDeadline` is a master TTL — whatever happens, the episode resolves.
 */

/** Klepto ids: a disjoint range above gates (5,000,000 — see the id-range comments
 *  in blueprint.ts / index.ts). Fresh id per episode so a client that missed a
 *  removal never lerps a stale sprite across the world. */
export const KLEPTO_ID_BASE = 6_000_000;

/** First incursion after boot — demo-friendly: a fresh deploy shows one within a minute. */
export const KLEPTO_FIRST_DELAY_MS = 45_000;
/** Nothing stealable anywhere (rare: every contract mid-reset) — retry soon. */
export const KLEPTO_RETRY_MS = 20_000;
/** Episode hard stop: no klepto state outlives this + the beam beat (§4.7 discipline). */
export const KLEPTO_MAX_LIFE_MS = 45_000;
/** Descent telegraph: spawn this high, fall this fast → ~1.9 s of "it's coming". */
export const KLEPTO_DROP_H = 600;
export const KLEPTO_FALL_SPEED = 320;
/** Prying takes visibly longer than a dig (MINE_DURATION_MS 1800) — a fat window
 *  to run over; with the descent + skitter the theft is telegraphed ≥ 6 s. */
export const PRY_DURATION_MS = 2600;
/** Faster than any robot (ROBOT_SPEED 80) on the approach — it beats you to the piece. */
export const KLEPTO_SKITTER_SPEED = 120;
/** Flee rhythm: fast dashes + taunt pauses average ~65 u/s — slower than a player,
 *  so a chase visibly gains ground; the panic dash is what resets the gap. */
export const KLEPTO_DASH_SPEED = 150;
export const KLEPTO_DASH_MIN = 110; // dash waypoint distance (world units)
export const KLEPTO_DASH_MAX = 200;
export const KLEPTO_HOME_BIAS = 0.6; // fraction of dashes aimed back at the beam spot
export const KLEPTO_TAUNT_PAUSE_MIN_MS = 500;
export const KLEPTO_TAUNT_PAUSE_SPAN_MS = 700;
/** Cornering geometry: panic strictly > capture, so ONE robot always triggers the
 *  dodge before contact (never catchable alone) and TWO closing from different
 *  bearings pin it — the two-robot weld cooperation, replayed as slapstick.
 *  Fleeing-stage only: the approach and the pry are brazen, or the theft could
 *  never land near a live worksite. */
export const KLEPTO_PANIC_RANGE = 90;
export const CAPTURE_RANGE = 36; // 1.5× INTERACT_RANGE — a forgiving pincer on phones
/** Guaranteed chase window after a theft before it may beam out. */
export const KLEPTO_MIN_FLEE_MS = 12_000;
/** Bot posse: bounded so the worksite never dissolves; 2 bots + a player is the pincer. */
export const KLEPTO_BOT_CHASERS = 2;
export const KLEPTO_RECRUIT_MS = 700; // posse top-up beat
/** Beam-out beat (capture or escape): long enough to read, short enough not to drag. */
export const BEAM_OUT_MS = 1400;
export const BEAM_RISE_SPEED = 260;
/** The whole episode stays inside its section (chunk isolation preserved; the
 *  klepto has no hi-vis vest and answers to no checkpoint). */
export const KLEPTO_EDGE_MARGIN = 60;
/** Mischief, never malice. */
export const EMOTE_TAUNT = ['😝', '🤪', '🙈'] as const;
export const EMOTE_TAUNT_COOLDOWN_MS = 3000;

export class Klepto {
  readonly id: number;
  stage = KleptoStage.Landing;
  x: number;
  y: number;
  targetX: number;
  targetY: number;
  /** Piece it is heading for / prying (revalidated EVERY tick; null when none). */
  targetPieceId: number | null = null;
  /** Piece it actually stole — set only when the pry lands. Drives the loot bit. */
  carriedPieceId: number | null = null;
  /** Where it beams out — its landing X (it leaves the way it came). */
  readonly beamSpotX: number;
  /** Master TTL: whatever else happens, the incursion resolves by this time (§4.7). */
  readonly lifeDeadline: number;
  /** Prying → the theft fires at this time. */
  pryDoneAt = 0;
  /** stoleAt + KLEPTO_MIN_FLEE_MS — the guaranteed chase window. */
  minEscapeAt = 0;
  /** Captured/Escaped → despawn at this time. */
  doneAt = 0;
  /** Fleeing dash/pause rhythm. */
  nextDashAt = 0;
  /** Taunt rate limit (not a Robot — its own field; rides maybeEmote's gate). */
  nextEmoteAt = 0;
  /** Bot-posse top-up beat. */
  nextRecruitAt = 0;

  constructor(id: number, x: number, y: number, now: number) {
    this.id = id;
    this.x = x;
    this.y = y;
    this.targetX = x;
    this.targetY = y;
    this.beamSpotX = x;
    this.lifeDeadline = now + KLEPTO_MAX_LIFE_MS;
  }

  /** Tappable / capturable / recruits bots — the on-the-ground stages. */
  get chaseable(): boolean {
    return (
      this.stage === KleptoStage.Skittering ||
      this.stage === KleptoStage.Prying ||
      this.stage === KleptoStage.Fleeing
    );
  }

  setTarget(x: number, y: number): void {
    this.targetX = x;
    this.targetY = y;
  }

  /** Standing at its waypoint (an arrival snaps exactly onto the target, so
   *  equality is the honest check) — drives the dash/pause rhythm. */
  get atTarget(): boolean {
    return this.x === this.targetX && this.y === this.targetY;
  }

  /** Wrap-aware constant-speed motion toward the current target (Robot.step's shape). */
  step(dt: number, wrapWidth: number, speed: number): boolean {
    const r = advanceToward(this, { x: this.targetX, y: this.targetY }, dt, speed, wrapWidth);
    this.x = r.x;
    this.y = r.y;
    return r.arrived;
  }

  toSnapshot(): EntitySnapshot {
    return {
      id: this.id,
      kind: EntityKind.Klepto,
      x: this.x,
      y: this.y,
      status: this.stage | (this.carriedPieceId !== null ? KLEPTO_LOOT_BIT : 0),
    };
  }
}
