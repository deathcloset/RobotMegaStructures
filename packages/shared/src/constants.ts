/** Human-facing project version + milestone codename (see CHANGELOG.md). */
export const APP_VERSION = '0.1.0';
export const APP_CODENAME = 'First Light';

/** Bumped on any wire-protocol change; C_HELLO is rejected on mismatch.
 *  v2 (Phase 1): adds the interact intent + piece/resource entity kinds. */
export const PROTOCOL_VERSION = 2;

/** Fixed-point scale for positions on the wire: 1/16-unit precision (§7.4). */
export const FP_SCALE = 16;

/** Server internal simulation rate (Hz) — §7.4. */
export const DEFAULT_TICK_HZ = 10;
/** Snapshot broadcast rate to clients (Hz) — §7.1/§7.4. */
export const DEFAULT_BROADCAST_HZ = 4;

/** One flat square chunk, world units on a side (Phase 0 has exactly one). */
export const WORLD_SIZE = 1024;
/** The single Phase 0 chunk id. */
export const CHUNK_ID = 0;

/** Robot movement speed, world units per second. */
export const ROBOT_SPEED = 80;
/** Distance (world units) within which a robot is considered "arrived". */
export const ARRIVE_EPSILON = 1.5;
/** Distance (world units) within which a robot can act on an entity — pick up
 *  from a depot or deliver to a ghost piece (§3 build loop). Larger than
 *  ARRIVE_EPSILON so a robot acts on reaching the piece, not on top of it. */
export const INTERACT_RANGE = 24;

/** In delta mode, force a full keyframe at least this often (ms). */
export const DEFAULT_KEYFRAME_INTERVAL_MS = 5000;

/** Client interpolation delay (ms) — turns 2–5 Hz into smooth motion (§7.4). */
export const DEFAULT_INTERP_DELAY_MS = 300;
