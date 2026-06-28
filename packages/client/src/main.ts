import {
  type AnyMessage,
  CHUNK_COLS,
  chunkColOf,
  DEFAULT_INTERP_DELAY_MS,
  DomainEvent,
  EntityKind,
  MessageType,
  PieceStatus,
  PROTOCOL_VERSION,
  RobotStatusBit,
  wrapDeltaX,
} from '@rms/shared';
import { Hud } from './hud/Hud';
import { Input } from './input/Input';
import { Connection, type ConnStatus } from './net/Connection';
import { Camera } from './render/Camera';
import { Stage } from './render/Stage';
import { ServerClock } from './world/clock';
import { EntityStore, type RenderEntity } from './world/EntityStore';

/** World-unit radius around a tap within which we grab/deliver instead of move. */
const TAP_PICK_RANGE = 60;
/** Per-tab session token (§4.7). sessionStorage keeps it across reloads but is
 *  per-tab, so two tabs can't fight over one robot. */
const TOKEN_KEY = 'rms.sessionToken';

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
const reconnectEl = document.getElementById('reconnect');

let camera: Camera;
let myRobotId: number | null = null;
let worldWidth = 0; // circumference (from welcome); enables wrap-aware tapping
let sessionToken: string | undefined = loadToken();
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

  new Input(stage.canvas, camera, { onTap, onLongPress });

  // (Re)connect → say hello, presenting our token so the server resumes our robot.
  conn.onOpen = () =>
    conn.send({ t: MessageType.C_HELLO, protocolVersion: PROTOCOL_VERSION, sessionToken });
  conn.onMessage = onMessage;
  conn.onStatus = updateNetUI;
  conn.connect();

  // A napped phone or a dropped network is the common case (§4.7): nudge a
  // reconnect the moment the tab is visible / online again, or on tap-to-retry.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') conn.ensureConnected();
  });
  window.addEventListener('online', () => conn.ensureConnected());
  window.addEventListener('pageshow', () => conn.ensureConnected());
  reconnectEl?.addEventListener('click', () => conn.ensureConnected());

  stage.app.ticker.add((ticker) => frame(ticker.deltaMS));
}

function onMessage(msg: AnyMessage): void {
  switch (msg.t) {
    case MessageType.S_WELCOME: {
      myRobotId = msg.yourRobotId;
      sessionToken = msg.sessionToken;
      saveToken(sessionToken);
      const [x0, , x1] = msg.worldBounds;
      worldWidth = x1 - x0;
      stage.setMyRobot(msg.yourRobotId);
      stage.setWorld(worldWidth, msg.groundY);
      camera.setWorldWidth(worldWidth);
      store.setWorldWidth(worldWidth);
      // Only re-frame on a fresh spawn — a resume keeps the player's camera.
      if (!msg.resumed) {
        camera.x = (x0 + x1) / 2; // the structure rises from the middle of the planet
        camera.y = msg.groundY - 200; // surface low in frame, sky above
      }
      break;
    }
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
    case MessageType.S_SECTIONS:
      stage.setSections(msg.sections);
      break;
  }
}

function onEvent(name: DomainEvent, _payload: unknown): void {
  if (name === DomainEvent.ContractCompleted) {
    showBanner('Contract complete! 🎉  Next blueprint incoming…', 6000);
  } else if (name === DomainEvent.ContractStarted) {
    showBanner('New contract — build! 🏗️', 4000);
  } else if (name === DomainEvent.SectionFull) {
    // Queued at a full checkpoint — brief; you're force-admitted within a few seconds.
    showBanner('🦺 Section full — waiting at the checkpoint…', 2000);
  }
}

/**
 * Resolve a tap to an intent. Empty-handed → grab a depot, or weld a piece that's
 * awaiting a partner; carrying → deliver to a ghost (placing it, or holding a weld
 * piece), or weld someone's hold. Otherwise → move. The server re-validates
 * everything (§4.2), so this just picks the friendliest target under the finger.
 */
function onTap(x: number, y: number): void {
  const carrying = myCarrying();
  let best: RenderEntity | null = null;
  let bestDist = TAP_PICK_RANGE;
  for (const e of rendered) {
    if (!actionable(e, carrying)) continue;
    // Measure X the short way around the cylinder so a tap near the seam still
    // grabs the entity on the other side of the wrap.
    const dx = worldWidth > 0 ? wrapDeltaX(e.x, x, worldWidth) : e.x - x;
    const d = Math.hypot(dx, e.y - y);
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

/** Plant (or move) the work-flag, rallying the builder crew to that area. */
function onLongPress(x: number, y: number): void {
  conn.send({ t: MessageType.C_INTENT_FLAG, tx: x, ty: y });
}

/** Can this robot act on entity `e` right now, given whether it's carrying? */
function actionable(e: RenderEntity, carrying: boolean): boolean {
  if (e.kind === EntityKind.Resource) return !carrying; // grab from a depot
  if (e.kind === EntityKind.Deposit) return !carrying && e.status > 0; // mine an ore vein
  if (e.kind === EntityKind.Flag) return e.status === myRobotId; // tap your own flag to pick it up
  if (e.kind === EntityKind.Piece) return carrying && e.status === PieceStatus.Ghost; // deliver
  if (e.kind === EntityKind.WeldPiece) {
    if (e.status === PieceStatus.Ghost) return carrying; // bring the beam (hold)
    if (e.status === PieceStatus.Reserved) return true; // weld a waiting hold
  }
  return false;
}

function myCarrying(): boolean {
  if (myRobotId === null) return false;
  const me = rendered.find((e) => e.id === myRobotId);
  return me !== undefined && (me.status & RobotStatusBit.Carrying) !== 0;
}

let bannerTimer = 0;
function showBanner(text: string, ms: number): void {
  if (!banner) return;
  banner.textContent = text;
  banner.style.display = 'block';
  window.clearTimeout(bannerTimer);
  bannerTimer = window.setTimeout(() => {
    banner.style.display = 'none';
  }, ms);
}

/** Show the "connection lost" overlay while we're not connected (§4.7). */
function updateNetUI(status: ConnStatus): void {
  if (!reconnectEl) return;
  if (status === 'open') {
    reconnectEl.style.display = 'none';
  } else {
    reconnectEl.textContent =
      status === 'reconnecting' ? 'Connection lost — reconnecting… (tap to retry)' : 'Connecting…';
    reconnectEl.style.display = 'block';
  }
}

function loadToken(): string | undefined {
  try {
    return sessionStorage.getItem(TOKEN_KEY) ?? undefined;
  } catch {
    return undefined;
  }
}
function saveToken(token: string): void {
  try {
    sessionStorage.setItem(TOKEN_KEY, token);
  } catch {
    // private mode / storage disabled — token stays in memory for this tab
  }
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
    if (e.kind !== EntityKind.Piece && e.kind !== EntityKind.WeldPiece) continue;
    total += 1;
    if (e.status === PieceStatus.Placed) placed += 1;
  }
  const me = myRobotId === null ? undefined : rendered.find((e) => e.id === myRobotId);
  hud.set({
    status: conn.status,
    robot: myRobotId ?? '—',
    zone: me ? `${chunkColOf(me.x) + 1}/${CHUNK_COLS}` : '—',
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
