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
