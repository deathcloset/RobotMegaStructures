import { DomainEvent } from '@rms/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Snapshotter } from '../broadcast/Snapshotter';
import type { ServerConfig } from '../config';
import { Metrics } from '../metrics/Metrics';
import type { WsGateway } from '../net/WsGateway';
import type { WorldRepo } from '../state/repository';
import type { ChunkRegistry } from './ChunkRegistry';
import { SimLoop } from './SimLoop';

/**
 * The crash guard (§4.7 spirit, applied to the loop itself): one thrown tick must
 * not kill the server for every connected phone — but a *persistently* broken sim
 * must not zombie along silently either. Stubs stand in for the world; the tick is
 * made to throw on demand via the registry's flagSection() (the first call the
 * tick body makes).
 */
function makeLoop(shouldThrow: () => boolean) {
  const config = { tickHz: 10, broadcastHz: 4 } as ServerConfig;
  const chunks = {
    advanceKleptoSpawner: () => {},
    flagSection() {
      if (shouldThrow()) throw new Error('boom');
      return null;
    },
    all: () => [].values(),
    settle: () => [],
    queuedCount: () => 0,
    chunksInView: () => [],
    sectionStats: () => [],
  } as unknown as ChunkRegistry;
  const gateway = {
    get all() {
      return [].values();
    },
    broadcastEvent: vi.fn(),
    sendEventTo: vi.fn(),
  } as unknown as WsGateway;
  const snapshotter = { build: vi.fn() } as unknown as Snapshotter;
  const repo = { saveChunkSnapshot: vi.fn() } as unknown as WorldRepo;
  const metrics = new Metrics();
  return { loop: new SimLoop(config, chunks, gateway, snapshotter, repo, metrics), metrics };
}

describe('SimLoop crash guard', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('survives a throwing tick and keeps ticking', () => {
    let throwNext = true;
    const { loop, metrics } = makeLoop(() => {
      const t = throwNext;
      throwNext = false; // only the first tick throws
      return t;
    });
    loop.start();
    vi.advanceTimersByTime(100); // first tick throws — absorbed
    expect(metrics.tickErrors).toBe(1);
    vi.advanceTimersByTime(300); // later ticks run fine
    loop.stop();
    expect(metrics.tickCount).toBeGreaterThan(0); // the loop lived on past the bad tick
    expect(metrics.tickErrors).toBe(1);
  });

  it('escalates (rethrows) after enough consecutive failures instead of zombie-ing', () => {
    const { loop, metrics } = makeLoop(() => true); // every tick throws
    loop.start();
    // Advancing through the 10th consecutive failure makes the guard rethrow out
    // of the timer callback — with fake timers that surfaces here.
    expect(() => vi.advanceTimersByTime(2000)).toThrow('boom');
    loop.stop();
    expect(metrics.tickErrors).toBe(10); // absorbed 9, rethrew on the 10th
    expect(metrics.tickCount).toBe(0); // the body never completed once
  });
});

describe('SimLoop klepto wiring (§3 slapstick)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function makeKleptoLoop(drained: Array<{ name: DomainEvent; payload?: unknown }>) {
    const config = {
      tickHz: 10,
      broadcastHz: 4,
      kleptoMinMs: 111,
      kleptoSpanMs: 222,
    } as ServerConfig;
    const calls: Array<{ what: string; args?: unknown[] }> = [];
    const chunkStub = {
      step: () => calls.push({ what: 'step' }),
      drainEvents: () => drained.splice(0, drained.length),
      fullSnapshot: () => [],
    };
    const chunks = {
      advanceKleptoSpawner: (...args: unknown[]) => calls.push({ what: 'spawner', args }),
      flagSection: () => null,
      all: () => [chunkStub].values(),
      settle: () => [],
      queuedCount: () => 0,
      chunksInView: () => [],
      sectionStats: () => [],
    } as unknown as ChunkRegistry;
    const gateway = {
      get all() {
        return [].values();
      },
      broadcastEvent: vi.fn(),
      sendEventTo: vi.fn(),
    } as unknown as WsGateway;
    const metrics = new Metrics();
    const loop = new SimLoop(
      config,
      chunks,
      gateway,
      { build: vi.fn() } as unknown as Snapshotter,
      { saveChunkSnapshot: vi.fn() } as unknown as WorldRepo,
      metrics,
    );
    return { loop, metrics, calls };
  }

  it('drives the spawner every tick, before the step loop, with the config cadence', () => {
    const { loop, calls } = makeKleptoLoop([]);
    loop.start();
    vi.advanceTimersByTime(150); // one tick
    loop.stop();
    const spawner = calls.find((c) => c.what === 'spawner');
    expect(spawner).toBeDefined();
    expect(spawner!.args!.slice(1)).toEqual([111, 222]); // the config knobs, in order
    // Ordering: the spawner fires before any chunk steps (a new klepto acts this tick).
    expect(calls.findIndex((c) => c.what === 'spawner')).toBeLessThan(
      calls.findIndex((c) => c.what === 'step'),
    );
  });

  it('counts klepto outcomes into the metrics as the events drain', () => {
    const drained = [
      { name: DomainEvent.KleptoCaptured, payload: { x: 1, y: 2 } },
      { name: DomainEvent.KleptoEscaped, payload: { x: 3, y: 4 } },
      { name: DomainEvent.PiecePlaced, payload: {} }, // bystander event — uncounted
    ];
    const { loop, metrics } = makeKleptoLoop(drained);
    loop.start();
    vi.advanceTimersByTime(150);
    loop.stop();
    expect(metrics.kleptoCaptured).toBe(1);
    expect(metrics.kleptoEscaped).toBe(1);
  });
});
