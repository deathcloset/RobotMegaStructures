import { createServer } from 'node:http';
import { APP_CODENAME, APP_VERSION } from '@rms/shared';
import { Snapshotter } from './broadcast/Snapshotter';
import { loadConfig } from './config';
import { log } from './log';
import { Metrics } from './metrics/Metrics';
import { handleMetrics } from './metrics/metricsServer';
import { WsGateway } from './net/WsGateway';
import { seedContract } from './sim/blueprint';
import { ChunkRegistry } from './sim/ChunkRegistry';
import { Robot } from './sim/Robot';
import { SimLoop } from './sim/SimLoop';
import { InMemoryWorldRepo } from './state/repository';

const config = loadConfig();
const metrics = new Metrics();
const repo = new InMemoryWorldRepo();
const chunks = new ChunkRegistry();

seedContract(chunks.primary, repo);
seedRobots();

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
    contractPieces: chunks.primary.pieceCount,
    gracePeriodMs: config.gracePeriodMs,
  });
  loop.start();
});

/** Seed NPC robots (negative ids) so a lone first player sees a living site. */
function seedRobots(): void {
  const chunk = chunks.primary;
  for (let i = 0; i < config.seedRobots; i++) {
    const robot = new Robot(
      -(i + 1),
      repo.nextStableId('npc'),
      Math.random() * chunk.size,
      Math.random() * chunk.size,
      true,
    );
    robot.setTarget(Math.random() * chunk.size, Math.random() * chunk.size);
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
