import { CHUNK_COLS } from '@rms/shared';
import { describe, expect, it } from 'vitest';
import { ChunkRegistry } from './ChunkRegistry';
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
  it('holds a robot at the checkpoint when the next section is at its cap', () => {
    const reg = new ChunkRegistry(1); // each section holds one robot
    reg.get(1)!.addOccupant(new Robot(-1, 'npc', 1500, 800, true)); // section 1 now full
    const player = new Robot(1, 'p', 1100, 800, false, 1); // walked to an x in section 1
    reg.get(0)!.addOccupant(player);

    const notices = reg.settle(1000);

    expect(reg.get(1)!.getRobot(1)).toBeUndefined(); // not admitted
    expect(reg.get(0)!.getRobot(1)).toBe(player); // held in its current section
    expect(player.blocked).toBe(true);
    expect(player.x).toBeLessThan(1024); // clamped back inside section 0
    expect(notices).toEqual([{ connId: 1, section: 1 }]); // the owner is nudged
  });

  it('admits only the free slots and queues the rest (no overfill)', () => {
    const reg = new ChunkRegistry(2); // section holds two
    reg.get(1)!.addOccupant(new Robot(-1, 'npc', 1500, 800, true)); // 1 resident → 1 free slot
    for (let i = 0; i < 3; i++) {
      reg.get(0)!.addOccupant(new Robot(i + 1, `p${i}`, 1100, 800, false, i + 1));
    }

    reg.settle(1000);

    expect(reg.get(1)!.occupantCount).toBe(2); // capped: resident + exactly one admitted
    expect(reg.get(0)!.occupantCount).toBe(2); // the other two stay queued
  });

  it('spawns new players into a section with room, never a full one', () => {
    const reg = new ChunkRegistry(1);
    expect(reg.spawnSection()).toBe(reg.get(0)); // primary has room
    reg.get(0)!.addOccupant(new Robot(-1, 'npc', 100, 800, true)); // primary now full
    expect(reg.spawnSection()).toBe(reg.get(1)); // → first section that still has room
  });

  it('lets a queued robot cross once a slot frees', () => {
    const reg = new ChunkRegistry(1);
    reg.get(1)!.addOccupant(new Robot(-1, 'npc', 1500, 800, true));
    const player = new Robot(1, 'p', 1100, 800, false, 1);
    reg.get(0)!.addOccupant(player);
    reg.settle(1000);
    expect(player.blocked).toBe(true);

    reg.get(1)!.removeOccupant(-1); // a spot opens
    player.x = 1100; // it steps toward its target again
    reg.settle(2000);

    expect(reg.get(1)!.getRobot(1)).toBe(player);
    expect(player.blocked).toBe(false);
  });
});
