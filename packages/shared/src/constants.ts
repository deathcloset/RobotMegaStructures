/** Human-facing project version + milestone codename (see CHANGELOG.md). */
export const APP_VERSION = '0.2.0';
export const APP_CODENAME = 'First Bolt';

/** Bumped on any wire-protocol change; C_HELLO is rejected on mismatch.
 *  v2 (Phase 1): adds the interact intent + piece/resource entity kinds.
 *  v3 (Phase 1): adds the session token for reconnect/resume (§4.7).
 *  v4 (Phase 1): adds the two-robot weld piece kind + reservation events.
 *  v5 (Phase 2): wide wrapping world — S_WELCOME carries groundY + wrapX and
 *               rectangular worldBounds (the world is a cylinder, see below).
 *  v6 (Phase 2): adds the ore-deposit entity kind (surface mining).
 *  v7 (Phase 2): adds the work-flag intent + flag entity kind (commandable crews).
 *  v8 (Phase 2): adds the SectionFull checkpoint event (OSHA caps).
 *  v9 (Phase 2): adds S_SECTIONS (per-section cap/occupancy for zone labels).
 *  v10 (Phase 2): adds the gate entity kind + nested-zone label fields (x/y/nested
 *               on SectionInfo) — capped interior chambers you opt into. */
export const PROTOCOL_VERSION = 10;

/** Fixed-point scale for positions on the wire: 1/16-unit precision (§7.4). */
export const FP_SCALE = 16;

/** Server internal simulation rate (Hz) — §7.4. */
export const DEFAULT_TICK_HZ = 10;
/** Snapshot broadcast rate to clients (Hz) — §7.1/§7.4. */
export const DEFAULT_BROADCAST_HZ = 4;

/**
 * The world is a CYLINDER (Phase 2): a wide side-scrolling planet whose X axis
 * WRAPS — walk far enough left or right and you arrive back where you started —
 * with a bounded vertical axis (sky above, surface below) up which the
 * megastructure rises. The circumference is tiled by a ring of equal-width
 * **sections** (the chunk grid): each is a self-contained worksite owned by one
 * sim unit, so "more sections = a bigger planet" and sections can later live on
 * different servers (§4.4/§4.5). Phase 0/1 were a single 1024² square; the wrap
 * math is decided once and server-authoritatively in `world.ts`.
 */
/** One section (chunk) of the planet, world units wide. */
export const SECTION_WIDTH = 1024;
/** How many sections tile the circumference (the chunk grid). Each is its own
 *  worksite with its own OSHA cap (cap enforcement lands the next slice). */
export const CHUNK_COLS = 6;
/** Planet circumference in world units — the X axis wraps over [0, WORLD_WIDTH).
 *  Derived from the section grid, so growing CHUNK_COLS grows the world. */
export const WORLD_WIDTH = SECTION_WIDTH * CHUNK_COLS;
/** Vertical extent in world units (y=0 is the top of the sky). Does not wrap. */
export const WORLD_HEIGHT = 1024;
/** The surface line (world Y). Robots live on/above it (clamped to [0, GROUND_Y])
 *  and the structure rises from here toward y=0; the band below is reserved for a
 *  later surface-mining/digging slice. */
export const GROUND_Y = 896;
/** The world's X axis wraps (it's a cylinder). Sent in S_WELCOME so the client
 *  renders the seam seamlessly and the camera loops all the way around. */
export const WORLD_WRAP_X = true;

/**
 * Nested zone (§4.4 "a part of the structure in the middle of other parts"): a
 * capped interior chamber that sits WITHIN a parent section rather than tiling the
 * ring. It floats above the surface, so ground-traversers pass underneath it
 * (entry is opt-in via a gate, never forced by walking past). These three numbers
 * are the chamber's geometry, shared so the server places entrants and the client
 * draws the room at the same size. Position is per-zone (rides S_SECTIONS).
 */
/** How far above the surface a nested chamber's centre floats (world units). */
export const NESTED_ZONE_DY = 300;
/** Chamber half-extents — entrants cluster inside this box; the client draws it. */
export const NESTED_ZONE_HALF_W = 120;
export const NESTED_ZONE_HALF_H = 70;

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

/** Disconnect grace window (ms): a dropped robot stays parked and reclaimable —
 *  position + carried item intact — this long before removal (§4.7). The cheap-
 *  phone reality is that sockets drop routinely, so this is normal traffic. */
export const DEFAULT_GRACE_PERIOD_MS = 120_000;

/** After a contract completes, pause this long (the celebration) before the
 *  blueprint resets to fresh ghosts so building loops (§2.5 "another contract"). */
export const DEFAULT_CONTRACT_RESET_MS = 6000;

/** Two-robot weld (§10): how long a holder waits for a welding partner before
 *  giving up and releasing the piece back to ghost (a reservation TTL, so a
 *  missing/dropped partner never deadlocks the piece). */
export const WELD_RESERVATION_TTL_MS = 12_000;
/** How long both robots must stay engaged for the weld to finish. Comfortably
 *  above the ~1s lag budget so the cooperation is forgiving and visible. */
export const WELD_DURATION_MS = 2000;

/** Surface mining (§ Phase 2). How long a robot digs a vein to extract one load
 *  — visible effort, comfortably above the ~1s lag budget. */
export const MINE_DURATION_MS = 1800;
/** Loads a full ore vein holds (also the max value of a Deposit's `status`). */
export const DEPOSIT_MAX = 6;
/** Renewable veins slowly refill between visits (loads per second), so heavy
 *  mining depletes a vein but the planet never runs dry. */
export const DEPOSIT_REGEN_PER_SEC = 0.15;
/** How many ore deposits to scatter on each section's surface. */
export const DEPOSIT_COUNT = 3;
