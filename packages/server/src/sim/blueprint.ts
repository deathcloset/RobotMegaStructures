import { DEPOSIT_COUNT, wrapX } from '@rms/shared';
import type { WorldRepo } from '../state/repository';
import type { Chunk } from './Chunk';
import { Deposit } from './Deposit';
import { Piece } from './Piece';
import { Resource } from './Resource';

// Entity-id ranges are kept disjoint for the PoC: player robots grow from 1, NPCs
// are negative, and seeded structure entities use high bases — so ids never
// collide across kinds on the wire (the client keys render entities by id).
const PIECE_ID_BASE = 1_000_000;
const RESOURCE_ID_BASE = 2_000_000;
const DEPOSIT_ID_BASE = 3_000_000;

/**
 * The starter contract: a multi-row block of ghost pieces standing ON the surface
 * and rising toward the sky (the megastructure begins), flanked by resource depots
 * spread along the ground so builder bots and players fan out on hauling journeys.
 * Depots sit a few hundred units to either side — far enough that the wide
 * wrapping world is felt, near enough to stay findable. Sized so a crowd of robots
 * — AI and human — has room to work before it completes and loops (§2.5, §3).
 */
export function seedContract(chunk: Chunk, repo: WorldRepo): void {
  const cx = chunk.width / 2; // the structure rises from the middle of the planet
  const ground = chunk.groundY;
  const cols = 6;
  const rows = 3;
  const spacing = 56;
  const startX = cx - ((cols - 1) * spacing) / 2;
  const baseY = ground - 48; // the bottom row rests just above the surface

  let n = 0;
  for (let r = 0; r < rows; r++) {
    // The top row is two-robot weld pieces — the high beams need a buddy (§10).
    const weld = r === rows - 1;
    for (let c = 0; c < cols; c++) {
      const x = startX + c * spacing;
      const y = baseY - r * spacing; // higher rows sit further up, toward the sky
      chunk.addPiece(new Piece(PIECE_ID_BASE + n, repo.nextStableId('piece'), x, y, weld));
      n += 1;
    }
  }

  const onSurface = ground - 18; // depots rest on the ground
  const depots: ReadonlyArray<readonly [number, number]> = [
    [cx - 320, onSurface],
    [cx + 320, onSurface],
    [cx - 760, onSurface],
    [cx + 760, onSurface],
  ];
  depots.forEach(([x, y], i) => {
    chunk.addResource(new Resource(RESOURCE_ID_BASE + i, repo.nextStableId('depot'), x, y));
  });

  // Ore veins scattered around the rest of the planet's surface — spaced roughly
  // evenly across the far arc (away from the structure) so prospecting means
  // actually roaming the wide wrapping world.
  const arcStart = cx + 640; // just past the near depots
  const arcSpan = chunk.width - 1280; // leave the structure's neighbourhood clear
  for (let i = 0; i < DEPOSIT_COUNT; i++) {
    const along = arcStart + (arcSpan * i) / (DEPOSIT_COUNT - 1);
    const jitter = (Math.random() * 2 - 1) * 90;
    const x = wrapX(along + jitter, chunk.width);
    chunk.addDeposit(new Deposit(DEPOSIT_ID_BASE + i, repo.nextStableId('ore'), x, onSurface));
  }
}
