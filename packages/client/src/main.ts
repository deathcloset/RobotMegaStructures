import {
  type AnyMessage,
  DEFAULT_INTERP_DELAY_MS,
  DomainEvent,
  EntityKind,
  MessageType,
  PieceStatus,
  PROTOCOL_VERSION,
  RobotStatusBit,
} from '@rms/shared';
import { Hud } from './hud/Hud';
import { Input } from './input/Input';
import { Connection } from './net/Connection';
import { Camera } from './render/Camera';
import { Stage } from './render/Stage';
import { ServerClock } from './world/clock';
import { EntityStore, type RenderEntity } from './world/EntityStore';

/** World-unit radius around a tap within which we grab/deliver instead of move. */
const TAP_PICK_RANGE = 60;

const params = new URLSearchParams(location.search);
const lagMs = num(params.get('lag'), 0);
const jitterMs = num(params.get('jitter'), 0);
const interpDelayMs = num(params.get('interp'), DEFAULT_INTERP_DELAY_MS);
const wsUrl = resolveWsUrl(params.get('ws'));

const stage = new Stage();
const store = new EntityStore();
const clock = new ServerClock();
const conn = new Connection(wsUrl, lagMs, jitterMs);
const hud = new Hud(document.getElementById('hud')!);
const banner = document.getElementById('banner');

let camera: Camera;
let myRobotId: number | null = null;
let lastViewportSent = 0;
let lastPingAt = 0;
// Most recently rendered entities — the hit-test set for taps.
let rendered: RenderEntity[] = [];

// Arrival-anchored playback clock (server-time ms). Renders behind the newest
// received serverTime by interpDelayMs — robust to asymmetric injected lag.
let newestServerTime = 0;
let playbackClock = 0;
let playbackInit = false;

// HUD rate counters
let snapshotsIn = 0;
let snapsPerSec = 0;
let lastBytesIn = 0;
let kbpsIn = 0;
let lastRateAt = performance.now();

async function main(): Promise<void> {
  await stage.init(document.getElementById('app')!);
  camera = new Camera(stage.screen.w, stage.screen.h);

  new Input(stage.canvas, camera, { onTap });

  conn.onOpen = () => conn.send({ t: MessageType.C_HELLO, protocolVersion: PROTOCOL_VERSION });
  conn.onMessage = onMessage;
  conn.connect();

  stage.app.ticker.add((ticker) => frame(ticker.deltaMS));
}

function onMessage(msg: AnyMessage): void {
  switch (msg.t) {
    case MessageType.S_WELCOME:
      myRobotId = msg.yourRobotId;
      stage.setMyRobot(msg.yourRobotId);
      stage.setWorldSize(msg.worldBounds[2]);
      camera.x = msg.worldBounds[2] / 2;
      camera.y = msg.worldBounds[3] / 2;
      break;
    case MessageType.S_SNAPSHOT_FULL:
      store.upsertFull(msg.entities, msg.serverTime);
      newestServerTime = Math.max(newestServerTime, msg.serverTime);
      snapshotsIn++;
      break;
    case MessageType.S_SNAPSHOT_DELTA:
      store.applyDelta(msg.added, msg.updated, msg.removed, msg.serverTime);
      newestServerTime = Math.max(newestServerTime, msg.serverTime);
      snapshotsIn++;
      break;
    case MessageType.S_PONG:
      clock.update(msg.clientTime);
      break;
    case MessageType.S_EVENT:
      onEvent(msg.name, msg.payload);
      break;
  }
}

function onEvent(name: DomainEvent, _payload: unknown): void {
  if (name === DomainEvent.ContractCompleted) showBanner();
}

/**
 * Resolve a tap to an intent. Empty-handed near a depot → grab; carrying near a
 * ghost piece → deliver; otherwise → move. The server re-validates either way
 * (§4.2), so this only picks the friendliest target under the finger.
 */
function onTap(x: number, y: number): void {
  const carrying = myCarrying();
  const wantKind = carrying ? EntityKind.Piece : EntityKind.Resource;
  let best: RenderEntity | null = null;
  let bestDist = TAP_PICK_RANGE;
  for (const e of rendered) {
    if (e.kind !== wantKind) continue;
    if (e.kind === EntityKind.Piece && e.status !== PieceStatus.Ghost) continue;
    const d = Math.hypot(e.x - x, e.y - y);
    if (d <= bestDist) {
      best = e;
      bestDist = d;
    }
  }
  if (best) {
    conn.send({ t: MessageType.C_INTENT_INTERACT, targetId: best.id });
  } else {
    conn.send({ t: MessageType.C_INTENT_MOVE, tx: x, ty: y });
  }
}

function myCarrying(): boolean {
  if (myRobotId === null) return false;
  const me = rendered.find((e) => e.id === myRobotId);
  return me !== undefined && (me.status & RobotStatusBit.Carrying) !== 0;
}

let bannerTimer = 0;
function showBanner(): void {
  if (!banner) return;
  banner.textContent = 'Contract complete! 🎉';
  banner.style.display = 'block';
  window.clearTimeout(bannerTimer);
  bannerTimer = window.setTimeout(() => {
    banner.style.display = 'none';
  }, 6000);
}

function frame(dtMs: number): void {
  const nowPerf = performance.now();
  conn.pump(nowPerf);

  if (nowPerf - lastPingAt > 1000) {
    lastPingAt = nowPerf;
    conn.send({ t: MessageType.C_PING, clientTime: nowPerf });
  }

  if (nowPerf - lastViewportSent > 300) {
    lastViewportSent = nowPerf;
    conn.send({
      t: MessageType.C_VIEWPORT,
      cx: camera.x,
      cy: camera.y,
      halfW: stage.screen.w / 2 / camera.scale,
      halfH: stage.screen.h / 2 / camera.scale,
    });
  }

  // advance the playback clock and ease it toward (newest - interpDelay)
  let renderTime = newestServerTime - interpDelayMs;
  if (newestServerTime > 0) {
    if (!playbackInit) {
      playbackClock = newestServerTime - interpDelayMs;
      playbackInit = true;
    }
    playbackClock += dtMs;
    const target = newestServerTime - interpDelayMs;
    playbackClock += (target - playbackClock) * 0.08;
    if (playbackClock > newestServerTime) playbackClock = newestServerTime;
    renderTime = playbackClock;
  }

  stage.applyCamera(camera);
  rendered = store.sampleAt(renderTime);
  stage.render(rendered);

  updateHud(nowPerf);
}

function updateHud(nowPerf: number): void {
  if (nowPerf - lastRateAt >= 1000) {
    const dt = (nowPerf - lastRateAt) / 1000;
    snapsPerSec = Math.round(snapshotsIn / dt);
    kbpsIn = (conn.bytesIn - lastBytesIn) / 1024 / dt;
    snapshotsIn = 0;
    lastBytesIn = conn.bytesIn;
    lastRateAt = nowPerf;
  }
  let placed = 0;
  let total = 0;
  for (const e of rendered) {
    if (e.kind !== EntityKind.Piece) continue;
    total += 1;
    if (e.status === PieceStatus.Placed) placed += 1;
  }
  hud.set({
    status: conn.connected ? 'connected' : 'connecting…',
    robot: myRobotId ?? '—',
    rtt_ms: Math.round(clock.rtt),
    interp_ms: interpDelayMs,
    lag_inj: lagMs ? `${lagMs}±${jitterMs}ms` : 'off',
    carrying: myCarrying() ? 'yes' : 'no',
    pieces: total > 0 ? `${placed}/${total}` : '—',
    snaps_s: snapsPerSec,
    in_kbps: kbpsIn.toFixed(1),
    zoom: camera.scale.toFixed(2),
  });
}

function num(v: string | null, fallback: number): number {
  if (v === null || v === '') return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function resolveWsUrl(override: string | null): string {
  if (override) return override;
  if (import.meta.env.VITE_WS_URL) return import.meta.env.VITE_WS_URL;
  if (import.meta.env.DEV) return 'ws://localhost:8080/ws';
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${location.host}/ws`;
}

main().catch((err) => {
  console.error(err);
  const el = document.getElementById('hud');
  if (el) el.textContent = `fatal: ${String(err)}`;
});
