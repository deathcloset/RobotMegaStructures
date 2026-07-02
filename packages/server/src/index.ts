import { createServer } from 'node:http';
import {
  APP_CODENAME,
  APP_VERSION,
  CHUNK_COLS,
  NESTED_ZONE_DY,
  NESTED_ZONE_HALF_W,
  ROBOT_SPEED,
} from '@rms/shared';
import { Snapshotter } from './broadcast/Snapshotter';
import { loadConfig } from './config';
import { log } from './log';
import { Metrics } from './metrics/Metrics';
import { handleMetrics } from './metrics/metricsServer';
import { WsGateway } from './net/WsGateway';
import { seedContract, seedVaultWorksite } from './sim/blueprint';
import type { Chunk } from './sim/Chunk';
import { ChunkRegistry } from './sim/ChunkRegistry';
import { NestedZone } from './sim/NestedZone';
import { Robot } from './sim/Robot';
import { SimLoop } from './sim/SimLoop';
import { InMemoryWorldRepo } from './state/repository';

const config = loadConfig();
const metrics = new Metrics();
const repo = new InMemoryWorldRepo();
// Sections vary in their OSHA cap — some tight (real bottlenecks you queue through),
// some roomy. The pattern is anchored to SECTION_CAPACITY and cycles across the ring,
// so the planet has a mix of crowded and quiet zones.
const CAP_MULT = [1, 0.45, 1.3, 0.65, 0.35, 1.15];
const MIN_SECTION_CAP = 3;
/** AI bots work, but not as well as players — their speed relative to a player's. */
const AI_SPEED_FACTOR = 0.72;
/** A section's seeded crew stays this far under its OSHA cap, so there's always
 *  room for visitors + roaming crews (tight zones sparse, roomy ones busy). */
const CREW_CAP_MARGIN = 3;
/** Seeded NPCs scatter vertically in a band this tall above the surface. */
const NPC_SPAWN_BAND_H = 200;
const sectionCaps = Array.from({ length: CHUNK_COLS }, (_, i) =>
  Math.max(MIN_SECTION_CAP, Math.round(config.sectionCapacity * CAP_MULT[i % CAP_MULT.length]!)),
);
const chunks = new ChunkRegistry(sectionCaps);

// Every section is its own worksite with its own crew (the chunk grid, § Phase 2).
let nextNpcId = 0;
for (const chunk of chunks.all()) {
  seedContract(chunk, repo);
  seedRobots(chunk);
}

// A nested zone (§4.4): a capped interior chamber inside the spawn section — "a part
// of the structure in the middle of other parts." Players opt into it through a gate
// (and queue at its hard cap); a small resident crew keeps it near the limit so the
// cap is felt right away.
const NESTED_ZONE_SECTION = 0;
const NESTED_ZONE_ID = 100; // disjoint from ring section ids (0..CHUNK_COLS-1)
const GATE_ID_BASE = 5_000_000; // disjoint from piece/resource/deposit/flag id ranges
seedNestedZone(chunks.get(NESTED_ZONE_SECTION) ?? chunks.primary, config.nestedZoneCap);

const httpServer = createServer((req, res) => {
  if (handleMetrics(req, res, metrics, config)) return;
  if (req.url === '/' || req.url === '/health') {
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end(`rms sim server ok — v${APP_VERSION} "${APP_CODENAME}"\n`);
    return;
  }
  res.writeHead(404);
  res.end();
});

const gateway = new WsGateway(httpServer, config, chunks, repo, metrics);
const loop = new SimLoop(config, chunks, gateway, new Snapshotter(config), repo, metrics);

const sampler = setInterval(() => metrics.sample(), 1000);
const heartbeat = setInterval(() => gateway.heartbeat(), 15_000);
const summary = setInterval(() => {
  const s = metrics.snapshot();
  log.info('metrics', {
    conns: s.connections,
    egress_kbps: s.egress_kbps,
    bytes_per_player_per_tick: s.bytes_per_player_per_tick,
    tick_p95: s.tick_ms_p95,
    entities: s.entities_in_view,
    queued: s.queued,
    mode: config.snapshotMode,
  });
}, config.metricsLogMs);

httpServer.listen(config.port, config.host, () => {
  log.info('listening', {
    version: `${APP_VERSION} "${APP_CODENAME}"`,
    host: config.host,
    port: config.port,
    tickHz: config.tickHz,
    broadcastHz: config.broadcastHz,
    snapshotMode: config.snapshotMode,
    lagMs: config.lagMs,
    jitterMs: config.jitterMs,
    seedRobots: config.seedRobots,
    seedBuilders: config.seedBuilders,
    seedMiners: config.seedMiners,
    seedCouriers: config.seedCouriers,
    sections: CHUNK_COLS,
    sectionCaps: sectionCaps.join('/'),
    nestedZone: `§${NESTED_ZONE_SECTION + 1} cap ${config.nestedZoneCap}`,
    piecesPerSection: chunks.primary.pieceCount,
    world: `${chunks.primary.width}x${chunks.primary.height} wrapX groundY=${chunks.primary.groundY}`,
    gracePeriodMs: config.gracePeriodMs,
  });
  loop.start();
});

/** Seed a section's NPC crew (negative ids, unique planet-wide) so every section is
 *  a living worksite: the first `seedBuilders` run the build loop autonomously (the
 *  first `seedMiners` of those prospect the ore veins); the next `seedCouriers` are
 *  delivery-swarm couriers (ferry material to a work-flag); the rest wander as ambiance. */
function seedRobots(chunk: Chunk): void {
  const span = chunk.x1 - chunk.x0;
  // Population scales with this section's cap, kept a margin below it so there's
  // always room for visitors + roaming crews: tight zones are sparse, roomy ones busy.
  const pop = Math.max(2, Math.min(config.seedRobots, chunk.capacity - CREW_CAP_MARGIN));
  const builders = Math.min(config.seedBuilders, pop);
  const couriers = Math.min(config.seedCouriers, pop - builders);
  for (let i = 0; i < pop; i++) {
    nextNpcId += 1;
    const y = chunk.groundY - 20 - Math.random() * NPC_SPAWN_BAND_H;
    const robot = new Robot(
      -nextNpcId,
      repo.nextStableId('npc'),
      chunk.x0 + Math.random() * span,
      y,
      true,
    );
    if (i < builders) {
      robot.isBuilder = true;
      robot.speed = ROBOT_SPEED * AI_SPEED_FACTOR;
      robot.prefersMining = i < config.seedMiners; // some prospect the veins
      robot.canMigrate = true; // roaming work crews — travel between sections
    } else if (i < builders + couriers) {
      robot.isCourier = true; // delivery swarm — ferries material to the work-flag
      robot.speed = ROBOT_SPEED * AI_SPEED_FACTOR;
    } else {
      robot.setTarget(
        chunk.x0 + Math.random() * span,
        chunk.groundY - Math.random() * NPC_SPAWN_BAND_H,
      );
    }
    chunk.addOccupant(robot);
  }
}

/** Seed a nested zone into a parent section: an elevated capped chamber with a gate
 *  on the surface, its own interior worksite (a reason to enter), and a small resident
 *  crew (cap − 1, clamped) that builds it — so a lone visitor takes the last slot and
 *  a second one queues at the gate. */
function seedNestedZone(parent: Chunk, cap: number): void {
  const zone = new NestedZone(
    NESTED_ZONE_ID,
    parent.id,
    cap,
    parent.centerX,
    parent.groundY - NESTED_ZONE_DY, // the chamber floats above the structure
    GATE_ID_BASE + parent.id,
    parent.centerX,
    parent.groundY - 18, // the gate stands on the surface below
  );
  parent.addZone(zone);
  seedVaultWorksite(parent, zone, repo); // ghosts + a depot inside the chamber
  const residents = Math.max(0, Math.min(cap - 1, 4));
  for (let i = 0; i < residents; i++) {
    nextNpcId += 1;
    const r = new Robot(
      -nextNpcId,
      repo.nextStableId('npc'),
      zone.x + (Math.random() * 2 - 1) * NESTED_ZONE_HALF_W * 0.6,
      zone.y,
      true,
    );
    r.insideZone = zone.id; // a resident worker living in the chamber…
    r.isBuilder = true; // …who builds the vault's interior contract
    r.speed = ROBOT_SPEED * AI_SPEED_FACTOR;
    parent.addOccupant(r);
    zone.occupants.add(r.id);
  }
}

function shutdown(): void {
  log.info('shutting down');
  clearInterval(sampler);
  clearInterval(heartbeat);
  clearInterval(summary);
  loop.stop();
  httpServer.close();
  setTimeout(() => process.exit(0), 100);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
