import { CHUNK_COLS, sectionCenterX } from '@rms/shared';
import type { Chunk } from './Chunk';
import type { Robot } from './Robot';

/**
 * The autonomous crew brains (§ Phase 2 crews/logistics): the builder loop
 * (haul/mine/weld + roaming work crews) and the delivery-swarm courier (ferry
 * material to the work-flag). Pure decision logic over a Chunk's state — the
 * Chunk stays the actor that owns the state and the one mutation entry point;
 * these functions are called from its step() and reach it only through its
 * internal crew-AI surface (see the marked members in Chunk).
 */

/** How often a roaming builder relocates to another section (ms): a base interval
 *  plus a random span, so crews migrate as a steady trickle rather than in lockstep
 *  — keeping cross-section traffic (and thus checkpoint queues) alive. */
const RELOCATE_MIN_MS = 10_000;
const RELOCATE_SPAN_MS = 15_000;
/** A "hot" section rotates this often (ms); relocating crews are biased toward it,
 *  so a focus area fills and its checkpoints visibly back up before it moves on.
 *  Derived from the clock so every section agrees without shared state. */
const HOT_PERIOD_MS = 30_000;
const HOT_BIAS = 0.4; // fraction of relocations that head for the hot section

/** A builder's dawdle between actions (ms, min + random span) — AI bots work,
 *  but visibly less efficiently than players. */
const BUILDER_DAWDLE_MIN_MS = 400;
const BUILDER_DAWDLE_SPAN_MS = 1400;
/** A courier's (shorter) beat between ferry runs (ms, min + random span). */
const COURIER_BEAT_MIN_MS = 300;
const COURIER_BEAT_SPAN_MS = 900;
/** Travellers aim near a section's centre, scattered this far to either side, so
 *  arriving crews spread out instead of stacking on one pixel. */
const ARRIVAL_SCATTER_X = 180;
/** How long a bot with nothing to do (no depot/ghost right now) waits before it
 *  looks again. */
const IDLE_RETRY_MS = 1000;

/** Autonomous build loop for an AI bot, including weld cooperation: weld a piece
 *  awaiting a partner if there's one (no material needed), else haul from the
 *  nearest depot to the nearest ghost. A short dawdle keeps bots visibly less
 *  efficient than players. The seed of the commandable crew/swarm. */
export function driveBuilder(chunk: Chunk, robot: Robot, now: number): void {
  // Roaming work crews: a migrating builder heads for another section and only
  // works again once it arrives — queuing at full checkpoints along the way. This
  // cross-section traffic is what makes the OSHA caps actually fill and queue.
  if (robot.migratingTo !== null) {
    if (chunk.id === robot.migratingTo)
      robot.migratingTo = null; // arrived → work here
    else if (robot.pendingAction === null) return; // still travelling / queuing
  }
  if (robot.pendingAction !== null) {
    chunk.resolvePending(robot, now);
    // Finished (and not now holding/welding) → dawdle before the next action.
    if (robot.pendingAction === null && robot.engagedPieceId === null) {
      robot.nextActionAt = now + BUILDER_DAWDLE_MIN_MS + Math.random() * BUILDER_DAWDLE_SPAN_MS;
    }
    return;
  }
  if (now < robot.nextActionAt) return;

  // Periodically pull up stakes and go work another section (first time staggered).
  if (robot.canMigrate) {
    if (robot.relocateAt === 0) {
      robot.relocateAt = now + Math.random() * RELOCATE_SPAN_MS;
    } else if (!robot.carrying && now >= robot.relocateAt) {
      robot.relocateAt = now + RELOCATE_MIN_MS + Math.random() * RELOCATE_SPAN_MS;
      // Bias toward the rotating "hot" section so crews converge and queue there;
      // otherwise pick any other section. The hot section is clock-derived, so all
      // sections agree without any shared state.
      const hot = Math.floor(now / HOT_PERIOD_MS) % CHUNK_COLS;
      robot.migratingTo =
        hot !== chunk.id && Math.random() < HOT_BIAS ? hot : chunk.randomOtherSection();
      robot.setTarget(
        sectionCenterX(robot.migratingTo) + (Math.random() * 2 - 1) * ARRIVAL_SCATTER_X,
        chunk.wanderY(),
      );
      return;
    }
  }

  // A vault crew (inside a chamber) works ONLY that chamber's interior contract —
  // haul its depot to its ghosts. Welds, work-flags, and prospecting are all
  // section-floor concerns, so they're skipped for a vault builder.
  const zone = robot.insideZone;
  if (zone === null) {
    const weldNeedingPartner = chunk.nearestReservedWeld(robot.x, robot.y, robot.id);
    if (weldNeedingPartner) {
      robot.setTarget(weldNeedingPartner.x, weldNeedingPartner.y);
      robot.pendingAction = { kind: 'weld', targetId: weldNeedingPartner.id };
      return;
    }
  }
  if (!robot.carrying) {
    if (zone !== null) {
      // Inside a vault: grab from the chamber's own depot.
      const depot = chunk.nearestResource(robot.x, robot.y, zone);
      if (depot) {
        robot.setTarget(depot.x, depot.y);
        robot.pendingAction = { kind: 'pickup', targetId: depot.id };
      } else {
        robot.nextActionAt = now + IDLE_RETRY_MS;
      }
      return;
    }
    // A work-flag rallies the whole crew: mine the nearest vein to the flag,
    // hauling back to the structure — the commandable-crew lever (§ Phase 2).
    const flag = chunk.nearestFlag(robot.x, robot.y);
    if (flag) {
      const flagged = chunk.nearestDeposit(flag.x, flag.y);
      if (flagged) {
        robot.setTarget(flagged.x, flagged.y);
        robot.pendingAction = { kind: 'mine', targetId: flagged.id };
        return;
      }
    }
    // No flag (or no vein near it): prospectors mine, other builders use the
    // convenient depots — each falls back to the other so none is stuck empty.
    const vein = chunk.nearestDeposit(robot.x, robot.y);
    const depot = chunk.nearestResource(robot.x, robot.y, null);
    const mine = robot.prefersMining ? vein : null;
    if (mine) {
      robot.setTarget(mine.x, mine.y);
      robot.pendingAction = { kind: 'mine', targetId: mine.id };
    } else if (depot) {
      robot.setTarget(depot.x, depot.y);
      robot.pendingAction = { kind: 'pickup', targetId: depot.id };
    } else if (vein) {
      robot.setTarget(vein.x, vein.y);
      robot.pendingAction = { kind: 'mine', targetId: vein.id };
    }
  } else {
    const ghost = chunk.nearestGhost(robot.x, robot.y, zone);
    if (ghost) {
      robot.setTarget(ghost.x, ghost.y);
      robot.pendingAction = { kind: 'deliver', targetId: ghost.id };
    } else {
      robot.nextActionAt = now + IDLE_RETRY_MS; // nothing to build (resetting) — wait
    }
  }
}

/**
 * Delivery-swarm courier (set-and-forget logistics, § Phase 2). When a work-flag is
 * planted anywhere on the planet, couriers FERRY material to that section and build
 * there: grab a load from wherever they are, carry it across the checkpoints to the
 * flag, deliver, then head back out to source another. With no flag they just help
 * build their current section. A courier's signature — visible on the wire — is a load
 * crossing section boundaries toward your flag (vs a builder, who migrates empty + mines).
 */
export function driveCourier(
  chunk: Chunk,
  robot: Robot,
  now: number,
  flagSection: number | null,
): void {
  if (robot.pendingAction !== null) {
    chunk.resolvePending(robot, now);
    if (robot.pendingAction === null && robot.engagedPieceId === null) {
      robot.nextActionAt = now + COURIER_BEAT_MIN_MS + Math.random() * COURIER_BEAT_SPAN_MS;
    }
    return;
  }
  if (now < robot.nextActionAt) return;

  if (!robot.carrying) {
    // Empty AT the delivery target → head back out to source another load elsewhere.
    if (flagSection !== null && chunk.id === flagSection) {
      if (robot.migratingTo === null) {
        robot.migratingTo = chunk.randomOtherSection();
        robot.setTarget(
          sectionCenterX(robot.migratingTo) + (Math.random() * 2 - 1) * ARRIVAL_SCATTER_X,
          chunk.wanderY(),
        );
      }
      return;
    }
    // Otherwise grab a load from the nearest depot right here, to ferry.
    const depot = chunk.nearestResource(robot.x, robot.y, null);
    if (depot) {
      robot.setTarget(depot.x, depot.y);
      robot.pendingAction = { kind: 'pickup', targetId: depot.id };
    } else {
      robot.nextActionAt = now + IDLE_RETRY_MS;
    }
    return;
  }
  // Carrying → deliver at the flagged section (ferry there), or build locally if no flag.
  const dest = flagSection ?? chunk.id;
  if (chunk.id === dest) {
    robot.migratingTo = null;
    const ghost = chunk.nearestGhost(robot.x, robot.y, null);
    if (ghost) {
      robot.setTarget(ghost.x, ghost.y);
      robot.pendingAction = { kind: 'deliver', targetId: ghost.id };
    } else {
      robot.nextActionAt = now + IDLE_RETRY_MS; // arrived but nothing to build — hold the load a beat
    }
  } else if (robot.migratingTo !== dest) {
    robot.migratingTo = dest; // set the heading once; settle carries it across checkpoints
    robot.setTarget(
      sectionCenterX(dest) + (Math.random() * 2 - 1) * ARRIVAL_SCATTER_X,
      chunk.wanderY(),
    );
  }
}
