import { createServer } from 'node:http';
import { APP_CODENAME, APP_VERSION, CHUNK_COLS, ROBOT_SPEED } from '@rms/shared';
import { Snapshotter } from './broadcast/Snapshotter';
import { loadConfig } from './config';
import { log } from './log';
import { Metrics } from './metrics/Metrics';
import { handleMetrics } from './metrics/metricsServer';
import { WsGateway } from './net/WsGateway';
import { seedContract } from './sim/blueprint';
import type { Chunk } from './sim/Chunk';
import { ChunkRegistry } from './sim/ChunkRegistry';
import { Robot } from './sim/Robot';
import { SimLoop } from './sim/SimLoop';
import { InMemoryWorldRepo } from './state/repository';

const config = loadConfig();
const metrics = new Metrics();
const repo = new InMemoryWorldRepo();
// Guarantee each section has headroom above its resident bots, so roaming bots can
// always flow through checkpoints (players pass regardless). Robust even if the env
// seeds a dense garrison — never let the cap sit at or below the seeded count.
const sectionCapacity = Math.max(config.sectionCapacity, config.seedRobots + 6);
const chunks = new ChunkRegistry(sectionCapacity);

// Every section is its own worksite with its own crew (the chunk grid, § Phase 2).
let nextNpcId = 0;
for (const chunk of chunks.all()) {
  seedContract(chunk, repo);
  seedRobots(chunk);
}

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
    sections: CHUNK_COLS,
    sectionCapacity,
    piecesPerSection: chunks.primary.pieceCount,
    world: `${chunks.primary.width}x${chunks.primary.height} wrapX groundY=${chunks.primary.groundY}`,
    gracePeriodMs: config.gracePeriodMs,
  });
  loop.start();
});

/** Seed a section's NPC crew (negative ids, unique planet-wide) so every section is
 *  a living worksite: the first `seedBuilders` run the build loop autonomously (the
 *  first `seedMiners` of those prospect the ore veins); the rest wander their
 *  section as ambiance. */
function seedRobots(chunk: Chunk): void {
  const span = chunk.x1 - chunk.x0;
  for (let i = 0; i < config.seedRobots; i++) {
    // Spread the crew across this section, near the surface.
    nextNpcId += 1;
    const y = chunk.groundY - 20 - Math.random() * 200;
    const robot = new Robot(
      -nextNpcId,
      repo.nextStableId('npc'),
      chunk.x0 + Math.random() * span,
      y,
      true,
    );
    if (i < config.seedBuilders) {
      robot.isBuilder = true;
      robot.speed = ROBOT_SPEED * 0.72; // AI bots work, but not as well as players
      robot.prefersMining = i < config.seedMiners; // some prospect the veins
    } else {
      robot.setTarget(chunk.x0 + Math.random() * span, chunk.groundY - Math.random() * 200);
    }
    chunk.addOccupant(robot);
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
