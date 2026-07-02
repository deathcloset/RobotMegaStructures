import {
  DomainEvent,
  EntityKind,
  KLEPTO_LOOT_BIT,
  KleptoStage,
  MessageType,
  PieceStatus,
} from '@rms/shared';
import { describe, expect, it } from 'vitest';
import { Chunk } from './Chunk';
import { BEAM_OUT_MS, KLEPTO_EDGE_MARGIN, KLEPTO_MAX_LIFE_MS } from './Klepto';
import { NestedZone } from './NestedZone';
import { Piece } from './Piece';
import { Resource } from './Resource';
import { Robot } from './Robot';

const interact = (targetId: number) => ({ t: MessageType.C_INTENT_INTERACT, targetId }) as const;
const moveTo = (tx: number, ty: number) => ({ t: MessageType.C_INTENT_MOVE, tx, ty }) as const;

/** The klepto as the wire sees it (tests stay black-box: read the snapshot). */
function kleptoOf(chunk: Chunk) {
  return chunk.fullSnapshot().find((e) => e.kind === EntityKind.Klepto);
}
const stageOf = (s: { status: number }) => s.status & 7;
const hasLoot = (s: { status: number }) => (s.status & KLEPTO_LOOT_BIT) !== 0;

/** `placedCount` must always equal the count of Placed section-floor pieces —
 *  the steal is the codebase's only decrement of `placed` outside a reset. */
function expectPlacedInvariant(chunk: Chunk): void {
  let placed = 0;
  for (const e of chunk.fullSnapshot()) {
    if (
      (e.kind === EntityKind.Piece || e.kind === EntityKind.WeldPiece) &&
      e.status === PieceStatus.Placed
    )
      placed += 1;
  }
  expect(chunk.placedCount).toBe(placed);
}

/**
 * A section with TWO plain pieces, one already built by a real player through the
 * real deliver path (so `placed` bookkeeping is true), leaving the contract
 * incomplete — i.e. exactly one stealable piece. Time is fully synthetic.
 */
function stealableChunk() {
  const chunk = new Chunk(0);
  const builder = new Robot(9, 'builder', 480, 820, false, 9);
  chunk.addOccupant(builder);
  chunk.addResource(new Resource(2_000_001, 'd', 480, 820));
  const placedPiece = new Piece(1_000_001, 'p1', 512, 820, false);
  const ghostPiece = new Piece(1_000_002, 'p2', 560, 820, false);
  chunk.addPiece(placedPiece);
  chunk.addPiece(ghostPiece);
  let now = 1000;
  chunk.applyIntent(9, interact(2_000_001)); // grab from the depot…
  for (let i = 0; i < 100 && !builder.carrying; i++) {
    now += 100;
    chunk.step(0.1, now);
  }
  chunk.applyIntent(9, interact(1_000_001)); // …and place piece 1 for real
  for (let i = 0; i < 100 && placedPiece.status !== PieceStatus.Placed; i++) {
    now += 100;
    chunk.step(0.1, now);
  }
  expect(placedPiece.status).toBe(PieceStatus.Placed);
  expect(chunk.isComplete).toBe(false); // 1 of 2 — stealable, not celebrating
  // Park the builder far from the action so it never accidentally captures.
  builder.x = 60;
  builder.y = 820;
  builder.halt();
  chunk.drainEvents();
  return { chunk, placedPiece, ghostPiece, builder, now };
}

/** Step until `done` (or a cap), returning the events seen along the way. */
function runKlepto(
  chunk: Chunk,
  now: number,
  done: (events: DomainEvent[]) => boolean,
  maxSteps = 700,
  eachTick?: (snap: ReturnType<typeof kleptoOf>) => void,
): { events: Array<{ name: DomainEvent; payload?: unknown }>; now: number } {
  const events: Array<{ name: DomainEvent; payload?: unknown }> = [];
  for (let i = 0; i < maxSteps && !done(events.map((e) => e.name)); i++) {
    now += 100;
    eachTick?.(kleptoOf(chunk));
    chunk.step(0.1, now);
    events.push(...chunk.drainEvents());
  }
  return { events, now };
}

describe('klepto incursion — the theft (§3 slapstick)', () => {
  it('lands, pries the placed piece back to a ghost, and flees with the loot', () => {
    const { chunk, placedPiece, now } = stealableChunk();
    chunk.spawnKlepto(now, 6_000_000);
    expect(chunk.hasKlepto).toBe(true);

    const { events } = runKlepto(chunk, now, (names) => names.includes(DomainEvent.KleptoStole));
    const stole = events.find((e) => e.name === DomainEvent.KleptoStole);
    expect(stole).toBeDefined();
    expect((stole!.payload as { pieceId: number }).pieceId).toBe(placedPiece.id);
    expect(placedPiece.status).toBe(PieceStatus.Ghost); // pried off
    expect(chunk.placedCount).toBe(0); // the decrement
    const k = kleptoOf(chunk)!;
    expect(stageOf(k)).toBe(KleptoStage.Fleeing);
    expect(hasLoot(k)).toBe(true); // visibly carrying OUR piece
    expectPlacedInvariant(chunk);
  });

  it('emits the landing klaxon with the section id', () => {
    const { chunk, now } = stealableChunk();
    chunk.spawnKlepto(now, 6_000_000);
    const landed = chunk.drainEvents().find((e) => e.name === DomainEvent.KleptoLanded);
    expect(landed).toBeDefined();
    expect((landed!.payload as { section: number }).section).toBe(0);
  });

  it('never steals weld pieces, vault pieces, or from a completed contract', () => {
    const chunk = new Chunk(0);
    const weld = new Piece(1_000_001, 'w', 400, 820, true);
    weld.status = PieceStatus.Placed;
    chunk.addPiece(weld);
    const vaultPiece = new Piece(1_000_002, 'v', 500, 600, false);
    vaultPiece.status = PieceStatus.Placed;
    vaultPiece.zoneId = 100;
    chunk.addPiece(vaultPiece);
    expect(chunk.hasStealable).toBe(false); // nothing on the menu

    chunk.spawnKlepto(1000, 6_000_001);
    chunk.drainEvents();
    const { events } = runKlepto(chunk, 1000, (names) => names.includes(DomainEvent.KleptoEscaped));
    // An empty-handed cameo: it ambles home and leaves without a theft.
    expect(events.some((e) => e.name === DomainEvent.KleptoStole)).toBe(false);
    expect(weld.status).toBe(PieceStatus.Placed);
    expect(vaultPiece.status).toBe(PieceStatus.Placed);
  });

  it('a lone robot within panic range never stops the brazen approach or the pry', () => {
    const { chunk, placedPiece, now } = stealableChunk();
    const bystander = new Robot(2, 'b', placedPiece.x + 60, 820, false, 2); // inside 90, outside 36
    chunk.addOccupant(bystander);
    chunk.spawnKlepto(now, 6_000_002);

    const { events } = runKlepto(chunk, now, (names) => names.includes(DomainEvent.KleptoStole));
    expect(events.some((e) => e.name === DomainEvent.KleptoStole)).toBe(true); // theft landed
    expect(events.some((e) => e.name === DomainEvent.KleptoCaptured)).toBe(false);
  });

  it('retargets if its piece resets under it, and shrugs off a foiled pry', () => {
    const { chunk, placedPiece, now } = stealableChunk();
    chunk.spawnKlepto(now, 6_000_003);
    // Yank the only stealable piece the moment the klepto starts skittering.
    const { events } = runKlepto(
      chunk,
      now,
      (names) => names.includes(DomainEvent.KleptoEscaped),
      700,
      (snap) => {
        if (snap && stageOf(snap) === KleptoStage.Skittering) {
          placedPiece.reset(); // contract reset stole its prize
        }
      },
    );
    expect(events.some((e) => e.name === DomainEvent.KleptoStole)).toBe(false);
    // (No placed-invariant check here: the hand-called piece.reset() bypasses the
    // contract counters on purpose — a real reset goes through advanceContract.)
  });
});

describe('klepto incursion — the chase and the pincer', () => {
  it('TWO robots within capture range pin it: piece restored, celebration, beam-out', () => {
    const { chunk, placedPiece, now } = stealableChunk();
    const a = new Robot(2, 'a', 900, 820, false, 2);
    const b = new Robot(3, 'b', 901, 820, false, 3);
    chunk.addOccupant(a);
    chunk.addOccupant(b);
    chunk.spawnKlepto(now, 6_000_004);

    let glue = false;
    const { events, now: tEnd } = runKlepto(
      chunk,
      now,
      (names) => names.includes(DomainEvent.KleptoCaptured),
      700,
      (snap) => {
        if (!snap) return;
        if (stageOf(snap) === KleptoStage.Fleeing) glue = true; // loot secured — pounce
        if (glue) {
          a.x = snap.x;
          a.y = snap.y;
          b.x = snap.x + 1;
          b.y = snap.y;
        }
      },
    );
    expect(events.some((e) => e.name === DomainEvent.KleptoCaptured)).toBe(true);
    expect(placedPiece.status).toBe(PieceStatus.Placed); // parts recovered
    expect(chunk.placedCount).toBe(1);
    // The two captors celebrate 🎉 (reliable, chance 1).
    const emotes = events.filter((e) => e.name === DomainEvent.RobotEmote);
    const captorIds = emotes.map((e) => (e.payload as { robotId: number }).robotId);
    expect(captorIds).toContain(a.id);
    expect(captorIds).toContain(b.id);
    expectPlacedInvariant(chunk);

    // The beam-out beat, then gone from the snapshot (delta `removed` cleanup).
    let after = tEnd;
    for (let i = 0; i < 30 && chunk.hasKlepto; i++) {
      after += 100;
      chunk.step(0.1, after);
    }
    expect(kleptoOf(chunk)).toBeUndefined();
  });

  it('ONE glued chaser can never capture it — it panic-dashes and ultimately escapes', () => {
    const { chunk, now } = stealableChunk();
    const chaser = new Robot(2, 'c', 900, 820, false, 2);
    chunk.addOccupant(chaser);
    chunk.spawnKlepto(now, 6_000_005);

    let travelled = 0;
    let prev: { x: number } | undefined;
    const { events } = runKlepto(
      chunk,
      now,
      (names) => names.includes(DomainEvent.KleptoEscaped),
      700,
      (snap) => {
        if (!snap) return;
        if (prev) travelled += Math.abs(snap.x - prev.x);
        prev = snap;
        chaser.x = snap.x; // glued right on top of it, every single tick
        chaser.y = snap.y;
      },
    );
    expect(events.some((e) => e.name === DomainEvent.KleptoCaptured)).toBe(false);
    expect(events.some((e) => e.name === DomainEvent.KleptoEscaped)).toBe(true);
    expect(travelled).toBeGreaterThan(300); // it visibly ran (panic dashes fired)
  });

  it('capturing it mid-pry denies the theft entirely', () => {
    const { chunk, placedPiece, now } = stealableChunk();
    const a = new Robot(2, 'a', 900, 820, false, 2);
    const b = new Robot(3, 'b', 901, 820, false, 3);
    chunk.addOccupant(a);
    chunk.addOccupant(b);
    chunk.spawnKlepto(now, 6_000_006);

    const { events } = runKlepto(
      chunk,
      now,
      (names) =>
        names.includes(DomainEvent.KleptoCaptured) || names.includes(DomainEvent.KleptoStole),
      700,
      (snap) => {
        if (snap && stageOf(snap) === KleptoStage.Prying) {
          a.x = snap.x;
          a.y = snap.y;
          b.x = snap.x + 1;
          b.y = snap.y;
        }
      },
    );
    expect(events.some((e) => e.name === DomainEvent.KleptoCaptured)).toBe(true);
    expect(events.some((e) => e.name === DomainEvent.KleptoStole)).toBe(false); // denied!
    expect(placedPiece.status).toBe(PieceStatus.Placed); // never left the wall
    expect(chunk.placedCount).toBe(1);
    expectPlacedInvariant(chunk);
  });

  it('parked and vaulted robots never count toward a capture', () => {
    const { chunk, now } = stealableChunk();
    const parked = new Robot(2, 'p', 0, 0, false, null); // owner dropped (§4.7)
    const vaulted = new Robot(3, 'v', 0, 0, false, 3);
    vaulted.insideZone = 100; // lifted into a chamber — can't pin through the wall
    chunk.addOccupant(parked);
    chunk.addOccupant(vaulted);
    chunk.spawnKlepto(now, 6_000_007);

    const { events } = runKlepto(
      chunk,
      now,
      (names) => names.includes(DomainEvent.KleptoEscaped),
      700,
      (snap) => {
        if (!snap) return;
        parked.x = snap.x;
        parked.y = snap.y;
        vaulted.x = snap.x + 1;
        vaulted.y = snap.y;
      },
    );
    expect(events.some((e) => e.name === DomainEvent.KleptoCaptured)).toBe(false);
    expect(events.some((e) => e.name === DomainEvent.KleptoEscaped)).toBe(true);
  });

  it('an uncontested escape self-heals: the crew rebuilds the stolen piece', () => {
    const { chunk, placedPiece, now } = stealableChunk();
    chunk.spawnKlepto(now, 6_000_008);
    const { events, now: afterEscape } = runKlepto(chunk, now, (names) =>
      names.includes(DomainEvent.KleptoEscaped),
    );
    expect(events.some((e) => e.name === DomainEvent.KleptoStole)).toBe(true);
    expect(placedPiece.status).toBe(PieceStatus.Ghost); // it got away with the part
    // The episode resolved within its hard bound.
    expect(afterEscape - now).toBeLessThanOrEqual(KLEPTO_MAX_LIFE_MS + BEAM_OUT_MS + 500);

    // An ordinary NPC builder + the depot rebuild it through the untouched loop.
    const builder = new Robot(-1, 'npc', 480, 820, true);
    builder.isBuilder = true;
    chunk.addOccupant(builder);
    let t = afterEscape;
    for (let i = 0; i < 600 && placedPiece.status !== PieceStatus.Placed; i++) {
      t += 100;
      chunk.step(0.1, t);
    }
    expect(placedPiece.status).toBe(PieceStatus.Placed);
    expectPlacedInvariant(chunk);
  });

  it('skips the restore if the crew already rebuilt the piece mid-chase (no double count)', () => {
    const { chunk, placedPiece, now } = stealableChunk();
    const a = new Robot(2, 'a', 900, 820, false, 2);
    const b = new Robot(3, 'b', 901, 820, false, 3);
    chunk.addOccupant(a);
    chunk.addOccupant(b);
    chunk.spawnKlepto(now, 6_000_009);

    let rebuilt = false;
    const { events } = runKlepto(
      chunk,
      now,
      (names) => names.includes(DomainEvent.KleptoCaptured),
      700,
      (snap) => {
        if (!snap || stageOf(snap) !== KleptoStage.Fleeing) return;
        if (!rebuilt) {
          // The crew re-delivers to the ghost mid-chase (hand-modelled)…
          rebuilt = true;
          const carrier = new Robot(4, 'r', placedPiece.x, placedPiece.y, false, 4);
          carrier.carrying = true;
          chunk.addOccupant(carrier);
          chunk.applyIntent(4, interact(placedPiece.id));
        } else {
          a.x = snap.x;
          a.y = snap.y;
          b.x = snap.x + 1;
          b.y = snap.y;
        }
      },
    );
    expect(events.some((e) => e.name === DomainEvent.KleptoCaptured)).toBe(true);
    expect(placedPiece.status).toBe(PieceStatus.Placed);
    expectPlacedInvariant(chunk); // restore was skipped — counted exactly once
  });

  it('stays clamped inside its section for the whole episode', () => {
    const { chunk, now } = stealableChunk();
    const chaser = new Robot(2, 'c', 900, 820, false, 2);
    chunk.addOccupant(chaser);
    chunk.spawnKlepto(now, 6_000_010);
    runKlepto(
      chunk,
      now,
      (names) => names.includes(DomainEvent.KleptoEscaped),
      700,
      (snap) => {
        if (!snap) return;
        chaser.x = snap.x + 10; // constant pressure so it panic-dashes a lot
        chaser.y = snap.y;
        expect(snap.x).toBeGreaterThanOrEqual(chunk.x0 + KLEPTO_EDGE_MARGIN - 1);
        expect(snap.x).toBeLessThanOrEqual(chunk.x1 - KLEPTO_EDGE_MARGIN + 1);
      },
    );
  });
});

describe('klepto incursion — chase intents and the bot posse', () => {
  it('tap-to-chase tracks the klepto, a move cancels it, and despawn self-clears it', () => {
    const { chunk, now } = stealableChunk();
    const player = new Robot(2, 'p', 900, 700, false, 2);
    chunk.addOccupant(player);
    chunk.spawnKlepto(now, 6_000_011);

    // Wait until it's chaseable, then tap it.
    let t = now;
    for (let i = 0; i < 50; i++) {
      const s = kleptoOf(chunk);
      if (s && stageOf(s) >= KleptoStage.Skittering) break;
      t += 100;
      chunk.step(0.1, t);
    }
    const kid = kleptoOf(chunk)!.id;
    chunk.applyIntent(2, interact(kid));
    expect(player.pendingAction).toEqual({ kind: 'chase', targetId: kid });

    t += 100;
    chunk.step(0.1, t);
    const s = kleptoOf(chunk)!;
    // Live re-target: the player's target tracks where the klepto just was (it can
    // move up to ~15 units within the same tick after the re-aim).
    expect(Math.abs(player.targetX - s.x)).toBeLessThan(20);

    chunk.applyIntent(2, moveTo(100, 800)); // a manual move cancels the chase
    expect(player.pendingAction).toBeNull();

    chunk.applyIntent(2, interact(kid)); // chase again, then let it escape
    for (let i = 0; i < 700 && chunk.hasKlepto; i++) {
      t += 100;
      chunk.step(0.1, t);
    }
    t += 100;
    chunk.step(0.1, t); // one more tick: the stale action self-clears
    expect(player.pendingAction).toBeNull();
    expect(player.moving).toBe(false); // halted, not wandering after a ghost
  });

  it('drafts at most 2 idle builders, never couriers/vaulted/migrating bots, and the worksite keeps building', () => {
    const { chunk, now } = stealableChunk();
    // Widen the contract so it can't complete mid-episode: plenty of ghosts to haul.
    for (let i = 0; i < 4; i++)
      chunk.addPiece(new Piece(1_000_010 + i, `g${i}`, 600 + i * 40, 820, false));
    // A pool of NPCs around the worksite: 4 idle builders + one of each ineligible kind.
    const builders: Robot[] = [];
    for (let i = 0; i < 4; i++) {
      const r = new Robot(-(10 + i), `b${i}`, 500 + i * 20, 820, true);
      r.isBuilder = true;
      chunk.addOccupant(r);
      builders.push(r);
    }
    const courier = new Robot(-20, 'courier', 520, 820, true);
    courier.isCourier = true;
    chunk.addOccupant(courier);
    const migrating = new Robot(-21, 'mig', 540, 820, true);
    migrating.isBuilder = true;
    migrating.canMigrate = true;
    migrating.migratingTo = 3;
    chunk.addOccupant(migrating);
    const vaulted = new Robot(-22, 'vault', 500, 600, true);
    vaulted.isBuilder = true;
    vaulted.insideZone = 100;
    chunk.addOccupant(vaulted);

    chunk.spawnKlepto(now, 6_000_012);
    let maxChasers = 0;
    const { events } = runKlepto(
      chunk,
      now,
      (names) =>
        names.includes(DomainEvent.KleptoEscaped) || names.includes(DomainEvent.KleptoCaptured),
      700,
      () => {
        let chasing = 0;
        for (const r of [...builders, courier, migrating, vaulted]) {
          if (r.pendingAction?.kind === 'chase') {
            chasing += 1;
            expect(r.isCourier).toBe(false); // the ferry promise holds
            expect(r.insideZone).toBeNull();
            expect(r.migratingTo).toBeNull();
          }
        }
        maxChasers = Math.max(maxChasers, chasing);
      },
    );
    expect(maxChasers).toBeGreaterThanOrEqual(1); // a posse formed…
    expect(maxChasers).toBeLessThanOrEqual(2); // …and stayed bounded
    // The rest of the crew kept building DURING the incursion.
    expect(events.some((e) => e.name === DomainEvent.PiecePlaced)).toBe(true);

    // Everyone goes back to work after the episode.
    let t = now + 80_000;
    for (let i = 0; i < 20; i++) {
      t += 100;
      chunk.step(0.1, t);
    }
    for (const r of builders) expect(r.pendingAction?.kind).not.toBe('chase');
  });

  it('a disconnecting chaser deadlocks nothing', () => {
    const { chunk, now } = stealableChunk();
    const player = new Robot(2, 'p', 900, 700, false, 2);
    chunk.addOccupant(player);
    chunk.spawnKlepto(now, 6_000_013);
    let t = now;
    for (let i = 0; i < 50; i++) {
      const s = kleptoOf(chunk);
      if (s && stageOf(s) >= KleptoStage.Skittering) break;
      t += 100;
      chunk.step(0.1, t);
    }
    chunk.applyIntent(2, interact(kleptoOf(chunk)!.id));
    chunk.removeOccupant(2); // mid-chase disconnect (grace expiry shape)
    // The episode still resolves cleanly by its hard bound.
    for (let i = 0; i < 700 && chunk.hasKlepto; i++) {
      t += 100;
      chunk.step(0.1, t);
    }
    expect(chunk.hasKlepto).toBe(false);
    expectPlacedInvariant(chunk);
  });

  it('a vaulted player who taps the klepto steps out of the chamber', () => {
    const { chunk, now } = stealableChunk();
    const zone = new NestedZone(100, 0, 3, 200, 500, 5_000_000, 200, 800);
    chunk.addZone(zone);
    const player = new Robot(2, 'p', 200, 500, false, 2);
    player.insideZone = 100;
    chunk.addOccupant(player);
    zone.occupants.add(2);

    chunk.spawnKlepto(now, 6_000_014);
    let t = now;
    for (let i = 0; i < 50; i++) {
      const s = kleptoOf(chunk);
      if (s && stageOf(s) >= KleptoStage.Skittering) break;
      t += 100;
      chunk.step(0.1, t);
    }
    chunk.applyIntent(2, interact(kleptoOf(chunk)!.id));
    expect(player.insideZone).toBeNull(); // chasing is floor work
    expect(zone.count).toBe(0);
    expect(player.pendingAction?.kind).toBe('chase');
  });
});
