import { CHUNK_COLS, GROUND_Y, MessageType, PieceStatus } from '@rms/shared';
import { describe, expect, it } from 'vitest';
import { ChunkRegistry } from './ChunkRegistry';
import { NestedZone } from './NestedZone';
import { Piece } from './Piece';
import { Resource } from './Resource';
import { Robot } from './Robot';

// The grid is CHUNK_COLS sections of SECTION_WIDTH (1024) tiling the planet.
describe('ChunkRegistry — the section grid', () => {
  it('routes a world-X to the section that owns it (wrapping at the seam)', () => {
    const reg = new ChunkRegistry();
    expect(reg.chunkAt(100).id).toBe(0);
    expect(reg.chunkAt(1500).id).toBe(1);
    expect(reg.chunkAt(5200).id).toBe(5);
    expect(reg.chunkAt(-1).id).toBe(CHUNK_COLS - 1); // just left of the seam wraps round
  });

  it('selects only the section(s) under a viewport, and all of them with none', () => {
    const reg = new ChunkRegistry();
    // A narrow view centred in section 2 sees just section 2.
    expect(reg.chunksInView(2560, 100).map((c) => c.id)).toEqual([2]);
    // A view straddling the 0|1 boundary sees both.
    expect(
      reg
        .chunksInView(1024, 100)
        .map((c) => c.id)
        .sort(),
    ).toEqual([0, 1]);
    // No reported viewport (infinite) → every section (worst-case fan-out).
    expect(reg.chunksInView(0, Number.POSITIVE_INFINITY).length).toBe(CHUNK_COLS);
  });

  it('hands a robot off to the section it has walked into', () => {
    const reg = new ChunkRegistry();
    const robot = new Robot(1, 'r', 1500, 800, false, 1); // x=1500 belongs to section 1
    reg.primary.addOccupant(robot); // but it starts (wrongly) in section 0
    expect(reg.chunkOfRobot(1)).toBe(reg.get(0));

    reg.settle();

    expect(reg.get(0)!.getRobot(1)).toBeUndefined();
    expect(reg.get(1)!.getRobot(1)).toBe(robot);
    expect(reg.chunkOfRobot(1)).toBe(reg.get(1));
  });
});

describe('ChunkRegistry — OSHA caps (§4.4)', () => {
  it('queues a BOT at the checkpoint when the next section is at its cap', () => {
    const reg = new ChunkRegistry(1); // each section holds one robot
    reg.get(1)!.addOccupant(new Robot(-2, 'resident', 1500, 800, true)); // section 1 full
    const bot = new Robot(-1, 'bot', 1100, 800, true); // an NPC walked to an x in section 1
    reg.get(0)!.addOccupant(bot);

    const notices = reg.settle(1000);

    expect(reg.get(1)!.getRobot(-1)).toBeUndefined(); // not admitted
    expect(reg.get(0)!.getRobot(-1)).toBe(bot); // held in its current section
    expect(bot.blocked).toBe(true);
    expect(bot.x).toBeLessThan(1024); // clamped back inside section 0
    expect(notices).toEqual([]); // bots get no nudge
  });

  it('queues a player briefly at a full section, then force-admits (never walled)', () => {
    const reg = new ChunkRegistry(1);
    reg.get(1)!.addOccupant(new Robot(-2, 'resident', 1500, 800, true)); // section 1 full
    const player = new Robot(1, 'p', 1100, 800, false, 1); // walked to an x in section 1
    reg.get(0)!.addOccupant(player);

    const n1 = reg.settle(1000);
    expect(player.blocked).toBe(true); // held at the checkpoint (queuing)
    expect(reg.get(1)!.getRobot(1)).toBeUndefined(); // not in yet
    expect(n1).toEqual([{ connId: 1, section: 1 }]); // nudged while waiting

    player.x = 1100; // still pushing toward section 1
    reg.settle(1000 + 4000); // past the bounded wait (3s)
    expect(reg.get(1)!.getRobot(1)).toBe(player); // force-admitted — never walled
    expect(player.blocked).toBe(false);
  });

  it('gives sections their own caps (an array) and reports them as stats', () => {
    const reg = new ChunkRegistry([4, 12]); // tight section 0, roomy section 1
    expect(reg.get(0)!.capacity).toBe(4);
    expect(reg.get(1)!.capacity).toBe(12);
    reg.get(0)!.addOccupant(new Robot(-1, 'n', 100, 800, true));
    const stats = reg.sectionStats();
    // Ring sections carry their label anchor (centre, up in the sky) and nested:false.
    expect(stats[0]).toEqual({ id: 0, cap: 4, count: 1, x: 512, y: GROUND_Y - 420, nested: false });
    expect(stats[1]).toEqual({
      id: 1,
      cap: 12,
      count: 0,
      x: 1536,
      y: GROUND_Y - 420,
      nested: false,
    });
  });

  it('appends nested zones to sectionStats (a nested zone is just another zone)', () => {
    const reg = new ChunkRegistry();
    reg.get(0)!.addZone(new NestedZone(100, 0, 3, 512, 596, 5_000_000, 512, 878));
    const stats = reg.sectionStats();
    expect(stats).toHaveLength(CHUNK_COLS + 1); // every ring section, plus the nested one
    const nested = stats.find((s) => s.nested);
    expect(nested).toEqual({ id: 100, cap: 3, count: 0, x: 512, y: 596, nested: true });
  });

  it('admits only the free slots and queues the rest of the bots (no overfill)', () => {
    const reg = new ChunkRegistry(2); // section holds two
    reg.get(1)!.addOccupant(new Robot(-99, 'resident', 1500, 800, true)); // 1 resident → 1 free
    for (let i = 0; i < 3; i++) {
      reg.get(0)!.addOccupant(new Robot(-(i + 1), `bot${i}`, 1100, 800, true));
    }

    reg.settle(1000);

    expect(reg.get(1)!.occupantCount).toBe(2); // capped: resident + exactly one admitted
    expect(reg.get(0)!.occupantCount).toBe(2); // the other two bots stay queued
  });

  it('spawns new players into a section with room, never a full one', () => {
    const reg = new ChunkRegistry(1);
    expect(reg.spawnSection()).toBe(reg.get(0)); // primary has room
    reg.get(0)!.addOccupant(new Robot(-1, 'npc', 100, 800, true)); // primary now full
    expect(reg.spawnSection()).toBe(reg.get(1)); // → first section that still has room
  });

  it('lets a queued bot cross once a slot frees', () => {
    const reg = new ChunkRegistry(1);
    reg.get(1)!.addOccupant(new Robot(-2, 'resident', 1500, 800, true));
    const bot = new Robot(-1, 'bot', 1100, 800, true);
    reg.get(0)!.addOccupant(bot);
    reg.settle(1000);
    expect(bot.blocked).toBe(true);

    reg.get(1)!.removeOccupant(-2); // a spot opens
    bot.x = 1100; // it steps toward its target again
    reg.settle(2000);

    expect(reg.get(1)!.getRobot(-1)).toBe(bot);
    expect(bot.blocked).toBe(false);
  });

  it('counts queued bots for the metrics readout', () => {
    const reg = new ChunkRegistry(1);
    reg.get(1)!.addOccupant(new Robot(-2, 'resident', 1500, 800, true)); // section 1 full
    reg.get(0)!.addOccupant(new Robot(-1, 'bot', 1100, 800, true)); // a bot wants in
    reg.settle(1000);
    expect(reg.queuedCount()).toBe(1);
  });

  it('a bot gives up and turns back after waiting too long (no checkpoint deadlock)', () => {
    const reg = new ChunkRegistry(1);
    reg.get(1)!.addOccupant(new Robot(-2, 'resident', 1500, 800, true)); // section 1 full
    const bot = new Robot(-1, 'bot', 1100, 800, true); // a builder migrating into section 1
    bot.isBuilder = true;
    bot.canMigrate = true;
    bot.migratingTo = 1;
    reg.get(0)!.addOccupant(bot);

    reg.settle(1000);
    expect(bot.blocked).toBe(true); // queuing at the checkpoint

    bot.x = 1100; // it keeps pushing toward the full section…
    reg.settle(7000); // …but ~6 s later it's past the bot's patience
    expect(bot.blocked).toBe(false); // gave up
    expect(bot.migratingTo).toBeNull(); // abandoned the crossing
    expect(reg.get(1)!.getRobot(-1)).toBeUndefined(); // never entered the full section
    expect(reg.get(0)!.getRobot(-1)).toBe(bot); // turned back into its own section
    expect(bot.targetX).toBeGreaterThanOrEqual(0); // …aimed back inside it
    expect(bot.targetX).toBeLessThan(1024);
  });
});

describe('ChunkRegistry — roaming work crews', () => {
  it('a roaming builder leaves its home section to work another', () => {
    const reg = new ChunkRegistry(); // 6 sections, no cap
    const b = new Robot(-1, 'b', reg.get(0)!.centerX, 800, true);
    b.isBuilder = true;
    b.canMigrate = true;
    reg.get(0)!.addOccupant(b);

    let now = 0;
    for (let i = 0; i < 700 && reg.chunkOfRobot(-1) === reg.get(0); i++) {
      now += 100;
      for (const c of reg.all()) c.step(0.1, now);
      reg.settle(now);
    }

    expect(reg.chunkOfRobot(-1)).not.toBe(reg.get(0)); // it migrated out of section 0
  });

  it('a non-roaming builder (canMigrate=false) stays put', () => {
    const reg = new ChunkRegistry();
    const b = new Robot(-1, 'b', reg.get(0)!.centerX, 800, true);
    b.isBuilder = true; // canMigrate defaults false
    reg.get(0)!.addOccupant(b);

    let now = 0;
    for (let i = 0; i < 300; i++) {
      now += 100;
      for (const c of reg.all()) c.step(0.1, now);
      reg.settle(now);
    }

    expect(reg.chunkOfRobot(-1)).toBe(reg.get(0)); // never wandered off
  });
});

describe('ChunkRegistry — work-flag persistence (§ Phase 2 crews/logistics)', () => {
  const flagAt = (tx: number, ty: number) => ({ t: MessageType.C_INTENT_FLAG, tx, ty }) as const;
  const interact = (targetId: number) => ({ t: MessageType.C_INTENT_INTERACT, targetId }) as const;
  const totalFlags = (reg: ChunkRegistry) => {
    let n = 0;
    for (const c of reg.all()) if (c.hasFlags) n += 1;
    return n;
  };

  /** A player in section 0 with a planted flag, then walked into section 1. */
  function plantAndCross() {
    const reg = new ChunkRegistry();
    const player = new Robot(1, 'p', 500, 800, false, 1);
    reg.get(0)!.addOccupant(player);
    reg.applyIntent(1, flagAt(500, 820)); // plant in section 0
    player.x = 1500; // walk into section 1…
    reg.settle(1000); // …and hand off at the checkpoint
    expect(reg.chunkOfRobot(1)).toBe(reg.get(1));
    return { reg, player };
  }

  it('a planted flag SURVIVES its owner crossing a section boundary (set-and-forget)', () => {
    const { reg } = plantAndCross();
    expect(reg.flagSection()).toBe(0); // still planted where it was dropped
  });

  it('replanting from another section moves the ONE flag (never two)', () => {
    const { reg } = plantAndCross();
    reg.applyIntent(1, flagAt(1600, 820)); // replant in the new section
    expect(reg.flagSection()).toBe(1); // the flag moved…
    expect(reg.get(0)!.hasFlags).toBe(false); // …the old one is gone…
    expect(totalFlags(reg)).toBe(1); // …exactly one planet-wide
  });

  it('tapping your own flag picks it up even from across the boundary', () => {
    const { reg } = plantAndCross();
    reg.applyIntent(1, interact(4_000_000 + 1)); // tap it from section 1
    expect(reg.flagSection()).toBeNull();
  });

  it("someone else's flag can't be picked up remotely", () => {
    const { reg } = plantAndCross();
    const other = new Robot(2, 'q', 1600, 800, false, 2);
    reg.get(1)!.addOccupant(other);
    reg.applyIntent(2, interact(4_000_000 + 1)); // robot 2 taps robot 1's flag id
    expect(reg.flagSection()).toBe(0); // still planted
  });

  it('a true removal (grace expiry) takes the remote flag too', () => {
    const { reg } = plantAndCross();
    reg.removeRobot(1);
    expect(reg.getRobot(1)).toBeUndefined();
    expect(reg.flagSection()).toBeNull(); // no orphaned flag left behind
  });
});

describe('ChunkRegistry — delivery-swarm logistics', () => {
  const flagAt = (tx: number, ty: number) => ({ t: MessageType.C_INTENT_FLAG, tx, ty }) as const;

  it('finds the section holding a work-flag (where the swarm delivers)', () => {
    const reg = new ChunkRegistry();
    expect(reg.flagSection()).toBeNull();
    const p = new Robot(1, 'p', reg.get(3)!.centerX, 800, false, 1);
    reg.get(3)!.addOccupant(p);
    reg.get(3)!.applyIntent(1, flagAt(reg.get(3)!.centerX, 820));
    expect(reg.flagSection()).toBe(3);
  });

  it('a courier ferries material from its section to the flagged one and builds there', () => {
    const reg = new ChunkRegistry(); // 6 sections, no cap
    // Destination §2: plant a flag and leave a ghost to build.
    const player = new Robot(1, 'p', reg.get(2)!.centerX, 800, false, 1);
    reg.get(2)!.addOccupant(player);
    reg.get(2)!.applyIntent(1, flagAt(reg.get(2)!.centerX, 820));
    const destGhost = new Piece(1_002_500, 'dg', reg.get(2)!.centerX, 820, false);
    reg.get(2)!.addPiece(destGhost);
    // Source §0: a depot and the courier.
    reg.get(0)!.addResource(new Resource(2_000_500, 'sd', reg.get(0)!.centerX, 820));
    const courier = new Robot(-1, 'c', reg.get(0)!.centerX, 820, true);
    courier.isCourier = true;
    reg.get(0)!.addOccupant(courier);

    let now = 0;
    let carriedAcross = false;
    for (let i = 0; i < 1500 && destGhost.status !== PieceStatus.Placed; i++) {
      now += 100;
      const fs = reg.flagSection();
      for (const c of reg.all()) c.step(0.1, now, fs);
      reg.settle(now);
      if (courier.carrying && reg.chunkOfRobot(-1) !== reg.get(0)) carriedAcross = true;
    }
    expect(carriedAcross).toBe(true); // carried a load out of its home section…
    expect(destGhost.status).toBe(PieceStatus.Placed); // …to the flagged section, and built it
    expect(reg.chunkOfRobot(-1)).toBe(reg.get(2)); // the courier delivered at the flag
  });
});
