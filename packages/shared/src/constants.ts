/** Bumped on any wire-protocol change; C_HELLO is rejected on mismatch. */
export const PROTOCOL_VERSION = 1;

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

/** In delta mode, force a full keyframe at least this often (ms). */
export const DEFAULT_KEYFRAME_INTERVAL_MS = 5000;

/** Client interpolation delay (ms) — turns 2–5 Hz into smooth motion (§7.4). */
export const DEFAULT_INTERP_DELAY_MS = 300;
