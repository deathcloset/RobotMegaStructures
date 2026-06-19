import type { IncomingMessage, ServerResponse } from 'node:http';
import type { ServerConfig } from '../config';
import type { Metrics } from './Metrics';

/**
 * Handles /metrics (Prometheus text) and /metrics.json (for the bot reporter and
 * quick curls). Returns true if it handled the request. NOTE: keep these off the
 * public internet (the Caddyfile does not proxy them) — operational data.
 */
export function handleMetrics(
  req: IncomingMessage,
  res: ServerResponse,
  metrics: Metrics,
  config: ServerConfig,
): boolean {
  const url = req.url ?? '/';
  if (url.startsWith('/metrics.json')) {
    const body = JSON.stringify({ ...metrics.snapshot(), config: publicConfig(config) });
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(body);
    return true;
  }
  if (url.startsWith('/metrics')) {
    res.writeHead(200, { 'content-type': 'text/plain; version=0.0.4' });
    res.end(toProm(metrics));
    return true;
  }
  return false;
}

function publicConfig(c: ServerConfig) {
  return {
    tickHz: c.tickHz,
    broadcastHz: c.broadcastHz,
    snapshotMode: c.snapshotMode,
    lagMs: c.lagMs,
    jitterMs: c.jitterMs,
  };
}

function toProm(metrics: Metrics): string {
  const s = metrics.snapshot();
  const lines: string[] = [];
  for (const [k, v] of Object.entries(s)) lines.push(`rms_${k} ${v}`);
  return `${lines.join('\n')}\n`;
}
