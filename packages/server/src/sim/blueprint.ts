import { DEPOSIT_COUNT, wrapX } from '@rms/shared';
import type { WorldRepo } from '../state/repository';
import type { Chunk } from './Chunk';
import { Deposit } from './Deposit';
import type { NestedZone } from './NestedZone';
import { Piece } from './Piece';
import { Resource } from './Resource';

// Entity-id ranges are kept disjoint for the PoC: player robots grow from 1, NPCs
// are negative, and seeded structure entities use high bases — so ids never
// collide across kinds on the wire (the client keys render entities by id).
const PIECE_ID_BASE = 1_000_000;
const RESOURCE_ID_BASE = 2_000_000;
const DEPOSIT_ID_BASE = 3_000_000;
/** Vault entities reuse the piece/resource id ranges but at a high per-section offset,
 *  disjoint from that section's own contract (which uses 0..~30). */
const VAULT_OFFSET = 900;

/** Vein placement across a section (fractions of its width), biased toward the
 *  edges so they sit away from the structure in the middle. */
const VEIN_FRACS = [0.12, 0.88, 0.3, 0.7, 0.5];

/**
 * Seed one section's self-contained worksite (§ Phase 2 chunk grid): a multi-row
 * block of ghost pieces standing ON the surface and rising toward the sky (this
 * section's slice of the megastructure), two flanking resource depots, and a few
 * ore veins out toward the section's edges. Every section seeds its own, so the
 * planet is a ring of worksites; entity ids are offset by the section id to stay
 * disjoint across the wire. Sized so a crew — AI and human — has room to work
 * before it completes and loops (§2.5, §3).
 */
export function seedContract(chunk: Chunk, repo: WorldRepo): void {
  const cx = chunk.centerX; // this section's worksite centre
  const ground = chunk.groundY;
  const idBase = chunk.id * 1000; // keep ids disjoint across sections
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
      chunk.addPiece(new Piece(PIECE_ID_BASE + idBase + n, repo.nextStableId('piece'), x, y, weld));
      n += 1;
    }
  }

  const onSurface = ground - 18; // depots + veins rest on the ground
  const depots: ReadonlyArray<readonly [number, number]> = [
    [cx - 320, onSurface],
    [cx + 320, onSurface],
  ];
  depots.forEach(([x, y], i) => {
    chunk.addResource(
      new Resource(RESOURCE_ID_BASE + idBase + i, repo.nextStableId('depot'), x, y),
    );
  });

  // Ore veins out toward this section's edges so prospecting means roaming within
  // — and across — sections.
  const span = chunk.x1 - chunk.x0;
  for (let i = 0; i < DEPOSIT_COUNT; i++) {
    const frac = VEIN_FRACS[i % VEIN_FRACS.length]!;
    const x = wrapX(chunk.x0 + frac * span, chunk.width);
    chunk.addDeposit(
      new Deposit(DEPOSIT_ID_BASE + idBase + i, repo.nextStableId('ore'), x, onSurface),
    );
  }
}

/**
 * Seed a nested vault's interior worksite (§4.4): a small row of ghost pieces plus a
 * depot, up inside the chamber. Tagged with the zone id, so only robots *inside* the
 * vault build them and they don't count toward the section's contract — a self-contained
 * reason to enter (and a reason for the resident crew to be there). The chamber loops on
 * its own (see `Chunk.advanceVaults`), faster than the section, so there's always work.
 */
export function seedVaultWorksite(chunk: Chunk, zone: NestedZone, repo: WorldRepo): void {
  const idBase = chunk.id * 1000 + VAULT_OFFSET;
  const cols = 3;
  const spacing = 44;
  const startX = zone.x - ((cols - 1) * spacing) / 2;
  for (let i = 0; i < cols; i++) {
    const piece = new Piece(
      PIECE_ID_BASE + idBase + i,
      repo.nextStableId('vaultpiece'),
      startX + i * spacing,
      zone.y,
      false,
    );
    piece.zoneId = zone.id;
    chunk.addPiece(piece);
  }
  const depot = new Resource(
    RESOURCE_ID_BASE + idBase,
    repo.nextStableId('vaultdepot'),
    zone.x,
    zone.y + 40,
  );
  depot.zoneId = zone.id;
  chunk.addResource(depot);
}
