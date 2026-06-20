import type { WorldRepo } from '../state/repository';
import type { Chunk } from './Chunk';
import { Piece } from './Piece';
import { Resource } from './Resource';

// Entity-id ranges are kept disjoint for the PoC: player robots grow from 1, NPCs
// are negative, and seeded structure entities use high bases — so ids never
// collide across kinds on the wire (the client keys render entities by id).
const PIECE_ID_BASE = 1_000_000;
const RESOURCE_ID_BASE = 2_000_000;

/**
 * The starter contract: a multi-row block of ghost pieces (it reads as a
 * structure "rising") plus several resource depots spread around the site so
 * builder bots and players fan out on little hauling journeys. Sized so a crowd
 * of robots — AI and human — has room to work before it completes and loops
 * (§2.5, §3).
 */
export function seedContract(chunk: Chunk, repo: WorldRepo): void {
  const cx = chunk.size / 2;
  const cols = 6;
  const rows = 3;
  const spacing = 56;
  const startX = cx - ((cols - 1) * spacing) / 2;
  const baseY = chunk.size * 0.46;

  let n = 0;
  for (let r = 0; r < rows; r++) {
    // The top row is two-robot weld pieces — the high beams need a buddy (§10).
    const weld = r === rows - 1;
    for (let c = 0; c < cols; c++) {
      const x = startX + c * spacing;
      const y = baseY - r * spacing; // higher rows sit further up the screen
      chunk.addPiece(new Piece(PIECE_ID_BASE + n, repo.nextStableId('piece'), x, y, weld));
      n += 1;
    }
  }

  const depots: ReadonlyArray<readonly [number, number]> = [
    [chunk.size * 0.16, chunk.size * 0.52],
    [chunk.size * 0.84, chunk.size * 0.52],
    [chunk.size * 0.3, chunk.size * 0.78],
    [chunk.size * 0.7, chunk.size * 0.78],
  ];
  depots.forEach(([x, y], i) => {
    chunk.addResource(new Resource(RESOURCE_ID_BASE + i, repo.nextStableId('depot'), x, y));
  });
}
