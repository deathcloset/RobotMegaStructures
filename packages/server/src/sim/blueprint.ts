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
 * A small starter contract: a 3-wide × 2-tall block of ghost pieces flanked by
 * two resource depots. The smallest blueprint that reads as a "structure" and
 * completes in a satisfying solo session (§9 — prove the fun, build small).
 */
export function seedContract(chunk: Chunk, repo: WorldRepo): void {
  const cx = chunk.size / 2;
  const cols = [cx - 70, cx, cx + 70];
  const rows = [chunk.size * 0.34, chunk.size * 0.34 - 64];
  let n = 0;
  for (const y of rows) {
    for (const x of cols) {
      chunk.addPiece(new Piece(PIECE_ID_BASE + n, repo.nextStableId('piece'), x, y));
      n += 1;
    }
  }

  const depots: ReadonlyArray<readonly [number, number]> = [
    [chunk.size * 0.22, chunk.size * 0.66],
    [chunk.size * 0.78, chunk.size * 0.66],
  ];
  depots.forEach(([x, y], i) => {
    chunk.addResource(new Resource(RESOURCE_ID_BASE + i, repo.nextStableId('depot'), x, y));
  });
}
