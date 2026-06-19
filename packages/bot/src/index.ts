import { parseArgs } from 'node:util';
import { BotClient } from './BotClient';
import { Reporter } from './reporter';

const { values } = parseArgs({
  options: {
    url: { type: 'string', default: 'ws://localhost:8080/ws' },
    count: { type: 'string', default: '50' },
    rate: { type: 'string', default: '2' },
    duration: { type: 'string', default: '0' },
    spawn: { type: 'string', default: '50' },
  },
});

const url = values.url as string;
const count = Number(values.count);
const rate = Number(values.rate);
const durationS = Number(values.duration);
const spawnPerSec = Number(values.spawn);

const bots: BotClient[] = [];
const reporter = new Reporter(bots);

console.log(`spawning ${count} bots -> ${url} (intent rate=${rate}Hz, ramp=${spawnPerSec}/s)`);

let spawned = 0;
const spawnTimer = setInterval(() => {
  const batch = Math.max(1, Math.round(spawnPerSec / 5)); // 5 batches/sec
  for (let i = 0; i < batch && spawned < count; i++) {
    const b = new BotClient(url, rate);
    b.start();
    bots.push(b);
    spawned += 1;
  }
  if (spawned >= count) clearInterval(spawnTimer);
}, 200);

const reportTimer = setInterval(() => reporter.print(), 1000);

if (durationS > 0) setTimeout(shutdown, durationS * 1000);

function shutdown(): void {
  console.log('shutting down bots…');
  clearInterval(spawnTimer);
  clearInterval(reportTimer);
  for (const b of bots) b.stop();
  setTimeout(() => process.exit(0), 200);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
