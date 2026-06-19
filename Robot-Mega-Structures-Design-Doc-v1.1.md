# Robot Mega Structures — Technical Design Document
### Proof-of-Concept Architecture & Implementation Plan

**Status:** Draft v1.1 · Prepared for engineering hand-off
**Date:** June 2026
**Scope:** This document covers the technical architecture for a proof of concept (PoC). It deliberately separates *what we must prove first* from *what the full vision needs*, so the developer can build the smallest thing that validates the core loop.

**Changes in v1.1 (post design-review):** added **§2.5** (scope, long-term vision, and the build-small discipline); added **§4.6** (architecture commitments) and **§4.7** (connection resilience); annotated the **§6** data model to separate persistent identity from transient contract state, made chunk contents entity-neutral, and added a domain-events catalogue; added **§7.4** (starting netcode parameters); noted **Valkey** as a Redis alternative in §5.5; and sharpened the two-robot reservation, reconnection, and tooling notes in §9–§10.

---

## 1. The Game in One Paragraph

Robot Mega Structures is a browser-based, massively multiplayer construction game. Players control tiny robots that cooperatively build an enormous structure — a terraforming arcology — on a barren, uninhabited planet. The camera zooms far in on the robots (infinite-canvas style) while the structure itself is so large it fades into the atmosphere. Human spectators watch and vote on build priorities but do not build. The robots do the work; nobody gets hurt. The defining constraint is **accessibility**: it must join from a web browser on the lowest-end hardware imaginable (a cheap Android phone on a poor connection), and scale to *hundreds, ideally thousands* of concurrent participants on a single structure.

---

## 2. Design Pillars (Non-Negotiables)

These constrain every technical decision below.

1. **Accessibility over fidelity.** Target the lowest common denominator: old phones, Chromebooks, tablets, shared/poor connections. No mandatory GPU compute. No mandatory native client. If a choice trades reach for richness, reach wins.
2. **Web-joinable, frictionless entry.** Open a URL, you're a robot, you're building. No mandatory account, no role selection up front. Role emerges from activity.
3. **Cooperative, never adversarial.** No player-vs-player. No us-vs-them. Shared progress, shared tools, shared rewards.
4. **Latency-tolerant.** This is *not* a twitch game. Up to ~1 second of end-to-end lag is acceptable (e.g., between one robot delivering a part and another welding it). This single fact unlocks most of the scaling strategy.
5. **Persistence as identity.** Robot progression (certifications, crew history) and completed structures persist permanently across sessions and contracts. Players can revisit arcologies they helped build, later inhabited by colonists. Memories are never wiped.

---

## 2.5 Scope & Long-Term Vision (Build Small, Big Vision in Mind)

This PoC is the first chapter of a longer arc, and it helps to be explicit about both — so the vision can guide our *structure* without becoming our *build plan*.

**The long-term universe (north star, not roadmap).** The fiction is self-justifying and worth keeping coherent: robots build a megastructure *for humans* → humans come to live in it → the planet must feed and sustain them → ships connect one planet to the next. As loose "levels," that suggests:

1. **Build** — robots cooperatively raise the structure. *(This PoC.)*
2. **Live** — a completed arcology becomes inhabited; players run human characters, and there is ongoing maintenance/service work for robots. A living-world endgame.
3. **Terraform / farm** — grow the arcology's food on-planet; cultivation feeds the life-sim layer. *(Out of scope.)*
4. **Interstellar** — fly (still 2D) between planets, each a circle you load into. *(Out of scope.)*

**What we are actually committing to build.** Level 1 — the construction MMO exactly as specified here — **plus its natural living-world endgame**: finish one structure, carry your robot's certifications / crew / history to the next contract, leave plaques on what you built, and eventually let a completed arcology fill with colonists and generate standing maintenance work so the building never truly "ends." That whole arc is achievable by a single small studio. Levels 3–4 are explicitly **not** in scope.

**The discipline: vision ≠ roadmap.** The four-level universe is *fuel* — it keeps the fiction consistent and tells us what the world could become. It is not a list of things we have committed to make. We commit only to Level 1 + the living endgame, and we let Phase 1 decide what (if anything) comes after.

**Why the endgame question can't be answered yet.** The real fork — "is cooperative building fun enough on its own, or do we need a living population for long-term retention?" — cannot be settled at the whiteboard. It is precisely the question Phase 1 ("prove the fun") exists to answer. If the core build loop is delightful under lag with many people, the later levels become expansions we've *earned the right* to build — and "another contract" (persistent identity, fresh blueprint) is a far cheaper retention bridge than a whole new mode. If the loop is only okay, no amount of life-sim or terraforming bolted on top will rescue it. So: build the town first.

**How we keep the later doors open without building them now.** The later modes are best understood as **modes of one engine** that reuse the same identity, persistence, and chunk/interest layers — *not* separate products that exchange assets over an API. A robot's certifications live in the same database whether it is welding a beam or repairing a pipe; there is nothing to "transmit." So the connection between modes is **shared foundations**, achieved by a clean, decoupled present (see the architecture commitments in §4.6), not by speculative export pipelines for games that don't exist yet. We deliberately do **not** build those APIs now: an interface with no consumer encodes wrong guesses and becomes a maintenance burden. We build a clean enough Level 1 that adding them later — *if* we ever genuinely split into separate products — is cheap.

---

## 3. Core Gameplay Summary (for the implementer)

The systems the architecture must support:

- **The build loop.** Robots gather resources (explore outward), transport them to the structure, and assemble pieces into place. Some assembly steps are designed to need two robots (one holds, one welds), which the netcode must accommodate under lag.
- **Contracts.** A structure is a contract with a defined blueprint and completion state. Build up, out, and down. "Ghost" blueprint hints show where pieces go. A server may run one large contract or several.
- **Chunks.** The structure/world is divided into a grid of chunks. Each chunk has a hard cap on concurrent robots (framed in-fiction as an "OSHA" workplace-safety limit). When a chunk completes, its robots disperse to new assignments. Players can also freely wander to find a less-populated chunk.
- **Certifications (global, ephemeral, shared).** Robots earn certifications (welding tools, vehicles, mining/construction equipment, architectural insight). While a certified robot is **online and on-site**, every robot on the site can use that capability. When the certified robot logs off, that capability is pulled for *new* tool grabs (in-progress users keep using it). A **logarithmic ceiling** caps how many certifications one robot can hold — elite robots exist but are rare. Certifications travel with the robot between sites permanently.
- **Crew patches (local, synergistic).** A soft grouping ("work patch" — pun on software patching intended). Robots who have worked together before get a proximity bonus when near each other. Different crews working together unlock an additional synergy bonus. An **apprenticeship bonus** rewards veterans for working *with newcomers*, and stacks with the crew bonus — explicitly designed to prevent clique formation. Bonuses are local/ambient, not global.
- **Spectators (passive, real influence).** Humans observe a lightweight 2D view, fly around, and **vote** on build priorities. Voting is soft and requires majority support to register — deliberately indirect to prevent trolling and accidental interference. Spectators can queue for full chunks and watch while they wait.
- **Aliens (shared flavor, not conflict).** Two benign types: *tourists* who land, photograph robots, and trade exotic materials for "souvenir" items dropped from inventory; and *klepto* aliens who pry off structure parts. Kleptos are **captured, not killed** (requires a security kit), parts recovered, and a captured klepto can itself be traded to tourists for a large bonus. No moral choices, no darkness — mischief, not malice.
- **Slapstick stakes.** Light pressure moments (e.g., asteroid strikes requiring repair, klepto incursions) create urgency and cooperation without an antagonist.

---

## 4. System Architecture

### 4.1 Shape of the system

```
                          ┌─────────────────────────────┐
   Browser clients        │      EDGE / PROXY LAYER      │
   (robots + spectators)  │  TLS, WS/WebTransport accept │
        │  WebSocket       │  connection fan-out, routing │
        ▼  (binary frames) └──────────────┬──────────────┘
   ┌──────────┐                           │
   │ PixiJS   │            ┌──────────────┴───────────────┐
   │ renderer │            │  CHUNK SIM SERVERS (1..N)     │
   │ + netcode│◄───state───┤  authoritative game loop      │
   │ + interp │   diffs    │  - owns a set of chunks       │
   └──────────┘            │  - validates inputs           │
                           │  - per-chunk interest mgmt    │
                           │  - cross-chunk handoff (OSHA)  │
                           └───────┬───────────────┬───────┘
                                   │               │
                         ┌─────────▼──────┐  ┌─────▼──────────┐
                         │ Redis           │  │ Postgres        │
                         │ hot chunk state │  │ durable data:   │
                         │ + pub/sub bus   │  │ accounts, certs,│
                         │ (cross-server)  │  │ crews, archives │
                         └─────────────────┘  └─────────────────┘
```

### 4.2 Authoritative server model

The server is the single source of truth. Clients send **intents** ("move toward X", "weld piece P", "pick up resource R"); they never assert authoritative state. The server validates every intent against rules (is this robot certified? is the piece adjacent? is the chunk under its cap?) and broadcasts resulting state changes. This is standard for any multiplayer game that wants to resist cheating and stay consistent, and it keeps the *client* dumb and cheap — exactly what low-end devices need.

Because we tolerate ~1s of latency, the server tick can be slow and forgiving. There is **no real-time physics engine**. Assembly is a small state machine (piece is `ghost → reserved → in-progress → placed`), not rigid-body simulation. This is the single biggest reason the project is feasible on modest hardware.

### 4.3 Chunking + interest management (the core scaling trick)

The world is a grid of chunks. A client **only subscribes to the chunks it can see** — its current chunk plus immediate neighbors. It never receives data about the thousands of robots working in distant chunks. This "area of interest" pattern is what keeps per-client bandwidth tiny regardless of total population (see §7).

Each chunk is owned by exactly one sim server. For the PoC, all chunks live in one process. To scale, chunks are distributed across multiple sim servers, and they coordinate through the Redis pub/sub bus.

### 4.4 The OSHA checkpoint *is* the sharding boundary

This is worth calling out as a genuine architectural strength of the design. The in-fiction rule — "only N robots allowed in this zone at once, pass through the safety checkpoint to cross to the next zone" — maps **exactly** onto the engineering need to (a) cap per-chunk load and (b) hand a player's connection from one sim server to another. The chunk cap is your load limit; the checkpoint is your handoff event; the queue-when-full behavior is your backpressure. The story and the infrastructure scale together, which is rare and lets us avoid an awkward, immersion-breaking "you are being moved to another server" message.

### 4.5 Scaling path

- **Start:** one sim server, one box. Validates the loop for hundreds of players.
- **Grow:** split chunks across more sim-server processes (same box, then more boxes); add the edge/proxy layer for connection fan-out; let Redis pub/sub carry cross-chunk events.
- **This mirrors how large Minecraft networks already scale** — a proxy layer in front, backend world servers behind, a shared database for player data so identity follows the player across servers without loss. We are borrowing a proven topology, not inventing one. ([WorldQL/Mammoth](https://worldql.com), [Minecraft network architecture](https://www.quora.com/How-does-a-large-Minecraft-server-network-work))

### 4.6 Architecture commitments (keeping the later doors open)

These decisions let Level 2+ reuse this engine instead of reimplementing it, at near-zero cost today. They are documentation of *how we build Level 1* — not extra features.

1. **Canonical data model, with persistent identity kept separable from transient contract state.** A robot's permanent self (certifications, crew, work history, hours) is a distinct concern from the here-and-now of a contract (chunk occupancy, piece states). Keep them cleanly separable in code and storage; never tangle "who this robot is" with "what it's doing on this job." (See §6.)
2. **Stable IDs and a versioned schema from day one.** Every durable entity gets a stable, permanent ID, and the schema is migration-managed from the first commit. Robot #X stays referenceable forever, by any future mode.
3. **Decoupled layers: sim / transport / rendering / persistence.** Keep these behind clean seams (the authoritative-server model already pushes this way). Decoupling is what lets a future life-sim mode run *on* this engine rather than as a fork of it.
4. **Spatial systems stay entity-neutral where it's free.** Chunks and interest management operate over generic *entities*, of which a build-piece is one kind — so colonists, crops, and other entities slot in later at no cost. Generalize **only** where it's free; do **not** build a speculative entity-component framework on spec.
5. **Domain events are first-class.** The events the netcode already emits (see §6) are also the seam future systems hook into. Treat the event stream as a real, named artifact, not an implementation detail.

The throughline: the best preparation for the future is a clean, decoupled present. If a thing only earns its keep in a game that doesn't exist yet, we don't build it — we build the clean foundation that makes adding it cheap later.

### 4.7 Connection resilience — reconnection is the common case

Pillar #1 (cheap Android phones, poor/shared connections) means dropped connections are **normal traffic, not an edge case**. The design must assume a player's socket vanishes for several seconds routinely. Required behavior:

- **Grace period on disconnect.** A robot whose owner drops doesn't instantly vanish; it enters a short grace window (idle/parked), then is cleanly removed if the owner doesn't return.
- **State survives a short reconnect.** A returning player resumes their robot's identity and — within the grace window — its position, carried item, and queued action, reconstructed from authoritative state rather than the client.
- **No action may deadlock on a dropped player.** Every reservation — especially the two-robot assembly (one holds, one welds) — carries a TTL, so a partner dropping mid-action releases the piece instead of freezing it. (Same mechanism as the §10 two-robot risk; design them together.)

---

## 5. Technology Stack

Every recommendation below was sanity-checked against current (2026) sources; see §11.

### 5.1 Transport — **WebSocket baseline, WebTransport as an enhancement**

WebSockets have **99%+ browser support, stable since 2013, with no breaking changes**, and work through the proxies and firewalls real users sit behind. For an accessibility-first game targeting old devices, this is the safe default. ([WebSocket.org browser support](https://websocket.org/reference/browser-support/))

WebTransport (over HTTP/3 / QUIC) **reached cross-browser "Baseline" status in March 2026** when Safari 26.4 shipped it (Chrome, Edge, and Firefox already had it). It offers unreliable datagrams and multiplexed streams — attractive for position updates. **However**, it requires an HTTP/3 server, a secure context, and an explicit port, and older devices (pre-Safari-26.4 iPhones, older Android browsers) still need a WebSocket fallback. ([WebTransport is Baseline](https://webrtc.ventures/2026/04/webtransport-is-now-baseline-what-it-means-for-real-time-media/), [WebTransport browser support](https://www.testmuai.com/learning-hub/webtransport-browser-support/))

**Recommendation:** Build on WebSocket for the PoC and for the long tail of cheap devices. Later, the well-known pattern is *datagrams for hot, droppable state (robot positions) + reliable streams for control events (joins, completions, certification grants)* — adopt WebTransport as an optional fast path with WebSocket fallback once the loop is proven. ([WS vs WebTransport 2026](https://techbytes.app/posts/webtransport-vs-websockets-low-latency-streaming-2026/))

### 5.2 Wire format — **MessagePack now, schema-based binary later**

Do **not** ship JSON on the hot path; it's too fat for position/build streams.

- **MessagePack** is schema-free, ~3× faster than JSON, ~17% smaller, and trivial to adopt. Best for the PoC and rapidly-evolving message shapes. ([binary serialization benchmark](https://medium.com/@shekhar.manna83/binary-serialization-formats-e2703f053010))
- **Protocol Buffers** give the best overall size/speed balance (notably smaller payloads) but require a shared `.proto` schema. Good when the protocol stabilizes.
- **FlatBuffers** offer the fastest (zero-copy) deserialization and are explicitly built for real-time/game data, at a higher serialize cost. Worth considering for the highest-frequency channels at scale. ([FlatBuffers benchmarks](https://flatbuffers.dev/benchmarks/))

**Recommendation:** MessagePack for the PoC; migrate the hot path to Protobuf or FlatBuffers (or a hand-rolled compact binary layout for robot deltas) when optimizing for the full player count.

### 5.3 Client rendering — **PixiJS v8 (WebGL)**

PixiJS is a mature, open-source 2D rendering engine built on **WebGL with optional WebGPU**, designed to run across all devices. It batches large numbers of sprites efficiently — ideal for "many tiny robots on an infinite canvas." ([PixiJS intro](https://pixijs.com/8.x/guides/getting-started/intro))

Crucial accessibility facts:
- **WebGL is supported on ~95% of browsers** (vs. WebGPU at roughly a quarter), and PixiJS recommends the **WebGL renderer for production**. This keeps Chromebooks and cheap phones in. ([PixiJS v8](https://pixijs.com/blog/pixi-v8-launches))
- As of v8.16 (2026), PixiJS added an **experimental pure-Canvas renderer for environments with neither WebGL nor WebGPU** — a genuine fallback for the absolute lowest-end target. ([PixiJS news](https://pixijs.com/blog))

A "shader/texture-pack upgrade" path (Minecraft-style) is feasible later for users who opt in, without compromising the baseline.

### 5.4 Server runtime — **Node + TypeScript for the PoC; Elixir/Phoenix for the full-scale build**

- **Node.js + TypeScript** is the pragmatic starting choice: best WebSocket ecosystem, fastest iteration, and *the same language as the browser client* (share types and protocol code end-to-end). Recommended for the PoC.
- **Elixir on the Phoenix framework** is the standout option for chasing the full thousands-on-one-structure vision on modest hardware. Its concurrency model maps almost perfectly onto this game: **each chunk can be a lightweight process and each player a process**, with built-in pub/sub. The published Phoenix benchmark held **~2 million concurrent WebSocket connections on a single large box (~1.5 KB RAM per connection)**, and even a commodity 4-core/16 GB machine sustained 300k+ connections at under 50% load. (WhatsApp independently reached 2M on Erlang, the same VM.) ([Road to 2M connections](https://www.phoenixframework.org/blog/the-road-to-2-million-websocket-connections), [reproduction at 2.3M](https://github.com/dsander/phoenix-connection-benchmark))

**Recommendation:** Prototype in Node/TS to move fast. Keep Elixir/Phoenix in your back pocket as the scale target; the chunk-as-process model is an unusually clean fit and may be worth adopting before the connection count gets serious.

### 5.5 Data stores

- **Redis (or Valkey)** — hot, in-memory chunk state and the cross-server **pub/sub bus**. Fast, simple, battle-tested for this role. *Licensing note:* Redis is now tri-licensed (AGPLv3 / RSALv2 / SSPLv1); self-hosting it as an internal component is free under that license, since we neither modify it nor offer it as a service. **Valkey** — the Linux Foundation's wire-compatible, BSD-licensed fork — is a drop-in alternative that sidesteps the licensing question entirely (a permissive license can't be relicensed out from under us) and is arguably the cleaner default for a self-hosting, zero-funding project. Our code doesn't change between them.
- **PostgreSQL** — durable data that must survive restarts and persist forever: player/account records, robot certifications, crew patches and shared work history, and the **archive of completed structures** (so they can be revisited and later shown inhabited).

### 5.6 Identity / auth

Keep it frictionless: anonymous/guest robots by default, with optional account linking to make progression permanent. Use an off-the-shelf auth library; don't build identity from scratch.

---

## 6. Data Model (sketch)

Indicative TypeScript-style shapes for the PoC (Node/TS); not final.

The shapes are split into two concerns we keep deliberately separate (see §4.6): **persistent identity**, which survives forever and travels with the player across contracts (and across future modes), and **transient contract state**, which lives in Redis and is scoped to a single job. Every durable entity carries a stable `id`, and the schema is migration-managed from day one.

```ts
// ── PERSISTENT IDENTITY (survives forever; travels across contracts & modes) ──

interface Account {
  id: string;
  isGuest: boolean;              // guest-first; optional linking makes it permanent
  linkedAt?: number;
  robotIds: string[];
}

// Persistent, travels with the player forever
interface Robot {
  id: string;
  ownerAccountId: string;
  certifications: CertId[];      // capped by logarithmic ceiling
  crewPatches: CrewPatchId[];    // groups this robot belongs to
  workHistory: ContractId[];     // structures helped build
  totalHoursOnSite: number;      // drives the certification ceiling
}

interface Certification {
  id: CertId;
  kind: "welding" | "vehicle" | "mining" | "construction" | "architecture";
  tier: number;                  // e.g. "welding tool mk.2"
  // NOTE: a cert is only ACTIVE for the whole site while its holder
  // is online & on-site. Track active grants in Redis, not Postgres.
}

interface CrewPatch {
  id: CrewPatchId;
  memberRobotIds: string[];
  // proximity + synergy + apprenticeship bonuses computed at runtime
}

// ── TRANSIENT CONTRACT STATE (lives in Redis; scoped to one contract) ──

// Hot, lives in Redis (with periodic durable snapshots to Postgres)
interface Chunk {
  id: ChunkId;
  contractId: ContractId;
  gridCoord: { x: number; y: number };
  capacity: number;              // the OSHA cap
  occupants: string[];           // robot ids currently inside
  entities: Entity[];            // entity-neutral on purpose (see §4.6):
                                 // a build-piece is ONE kind of Entity.
                                 // Colonists, crops, aliens, etc. are other
                                 // kinds added in later modes at no cost.
  ownerSimServerId: string;      // which sim process owns this chunk
}

// An Entity is anything that occupies a chunk's space. For the PoC the only
// kind is a build-piece; the neutral base is what lets future modes reuse the
// chunk + interest-management systems for free.
interface Entity {
  id: string;
  kind: "piece" | string;        // open-ended on purpose
  pos: { x: number; y: number }; // fixed-point on the wire (see §7.4)
}

interface PieceState extends Entity {
  kind: "piece";
  status: "ghost" | "reserved" | "in_progress" | "placed";
  reservedBy?: string[];         // robot id(s); a two-robot weld lists two
  reservationExpiresAt?: number; // TTL — a dropped robot releases the piece (§4.7)
}

interface Contract {
  id: ContractId;
  planetName: string;
  blueprint: BlueprintRef;       // defines piece graph + completion states
  status: "active" | "complete";
  plaques: Plaque[];             // names of contributors, per section
}

interface Spectator {
  id: string;
  isHuman: true;
  currentVote?: PriorityVote;    // soft, needs majority to register
}

interface Alien {
  id: string;
  kind: "tourist" | "klepto";
  state: string;                 // wandering | trading | stealing | captured
}
```

### Domain events (the netcode mechanism *and* the future-mode seam)

The server already broadcasts state changes for netcode; we treat that stream as a first-class, named catalogue (see §4.6). Starting set (names indicative):

- **Movement / presence:** `robot.moved`, `robot.entered_chunk`, `robot.left_chunk`, `robot.disconnected`, `robot.reconnected`
- **Build loop:** `resource.picked_up`, `resource.delivered`, `piece.reserved`, `piece.reservation_expired`, `piece.progressed`, `piece.placed`
- **Contracts / chunks:** `chunk.completed`, `contract.completed`, `chunk.handoff` (the OSHA checkpoint, §4.4)
- **Identity / social:** `cert.granted`, `cert.activated_for_site`, `cert.deactivated_for_site`, `crew.bonus_applied`, `apprenticeship.bonus_applied`
- **Flavor / stakes:** `spectator.vote_registered`, `alien.spawned`, `klepto.captured`, `asteroid.struck`

The point is not the exact names but that the catalogue *exists*, is stable, and is where future modes (maintenance, life-sim) subscribe — rather than reaching into internal state.

---

## 7. Bandwidth & Capacity Analysis

This section answers the original feasibility question directly: *is a single nice box on a gigabit line enough?*

### 7.1 Per-client downstream (the good news)

Thanks to interest management (§4.3), a client only hears about robots in its current + neighboring chunks — on the order of **50–150 robots in view**, never the global population. A robot delta (position as fixed-point, facing/anim, carried item, id) packs into roughly **~16 bytes**. With the 1-second lag budget and client-side interpolation, an update rate of **2–5 Hz** is ample.

```
150 robots × 16 bytes × 5 Hz  ≈ 12 KB/s
+ build-event deltas (bursty, small) + framing overhead
≈ 15–30 KB/s typical per active client
```

For reference, Minecraft already pushes roughly **50–100 KB/s per active player**, so our target sits *below* what cheap devices and connections handle today. The solar-charged Android phone is fine. ([Minecraft bandwidth](https://thehake.com))

### 7.2 Aggregate server egress (where the real limit is)

The bottleneck is **fan-out**, not CPU and not connection-holding. Total egress scales roughly linearly with concurrent players:

```
10,000 concurrent × ~20 KB/s  ≈ 200 MB/s  ≈ ~1.6 Gbps
```

**So a single 1 Gbps link is the binding constraint for the full 10,000-player dream** — not the processor. Options:
- A fatter pipe (10 GbE is standard and cheap in datacenters), or
- Horizontal fan-out: split chunks across sim servers / an edge layer (the §4.4 path).

Connection-holding itself is nearly free: at Phoenix's ~1.5 KB/connection, 10,000 sockets is ~15 MB of RAM. The cost is bytes out the door and per-tick CPU to assemble each client's view.

### 7.3 PoC capacity verdict

For the proof of concept, a **single modest box (8–16 cores, 16–32 GB RAM) on a gigabit line handles hundreds of concurrent players with enormous headroom** — likely up to ~1,000 given how cheap per-connection cost is. The gigabit ceiling only bites in the **high thousands**, and the architecture is explicitly designed to scale out from there. **Build the PoC on one box; don't pay for distribution until the loop is proven.**

> *Infra note:* the reference PoC box (12c/24t, 128 GB RAM, 1.92 TB NVMe, 1 Gbps, Ubuntu 24.04) comfortably exceeds the spec above. CPU/RAM are not the limit; the 1 Gbps pipe is, exactly per §7.2, and only in the high thousands. Confirm whether the port is **unmetered** or has a monthly transfer cap before relying on sustained egress. It is a single box, so it is also a single point of failure — fine for a PoC, but snapshot Postgres off-box early (see pillar #5 and §7.4).

### 7.4 Netcode parameters (starting values, to be tuned in Phase 0)

Phase 0's goal — "smooth movement at 2–5 Hz under artificial 1s lag" — needs concrete targets. These are starting guesses to validate and tune, not final:

- **Server internal tick:** ~10 Hz (the sim updates faster than it broadcasts; assembly is a slow state machine, so this is forgiving).
- **Broadcast / snapshot rate to clients:** 2–5 Hz, per §7.1.
- **Client interpolation buffer:** ~200–500 ms. The 1s latency budget makes a generous buffer affordable; this is what turns 2–5 Hz updates into smooth on-screen motion.
- **Position on the wire:** fixed-point (e.g. 1/16-unit precision), not float — smaller and consistent across devices.
- **Durable snapshot cadence (Redis → Postgres):** completed pieces and contract/identity events are written **immediately/transactionally** — they must never be lost (pillar #5). In-flight chunk state is snapshotted every *N* seconds.
- **Accepted crash-loss window:** on a single box (a current SPOF), we accept losing up to *N* seconds of *in-flight* progress on a crash — never completed work. Pin *N* against real Phase 0–1 behavior.

---

## 8. Build vs. Buy

| Concern | Decision | Choice |
|---|---|---|
| Transport | **Buy** | WebSocket library (+ WebTransport later) |
| Client rendering | **Buy** | PixiJS v8 (WebGL renderer) |
| Wire serialization | **Buy** | MessagePack → Protobuf/FlatBuffers |
| Hot state + pub/sub | **Buy** | Redis |
| Durable data | **Buy** | PostgreSQL |
| Auth/identity | **Buy** | Off-the-shelf auth (guest-first) |
| Authoritative simulation | **Build** | Tick loop, intent validation |
| Chunking + interest mgmt | **Build** | Subscription/AOI logic |
| OSHA checkpoint / handoff | **Build** | Cross-server player handoff |
| Game logic | **Build** | Certs, crew patches, aliens, build mechanics, contracts, voting |
| Network protocol design | **Build** | Message schema, batching, interpolation contract |

The pattern: buy the plumbing, build the game.

---

## 9. Proof-of-Concept Phasing

Cut hard. Prove the riskiest thing first: *do many people building one thing over a laggy connection actually feel good?*

**Phase 0 — Skeleton (prove the pipe).**
One sim server (Node/TS), WebSocket transport, MessagePack frames, PixiJS canvas. A handful of robots move around one chunk on a flat site. State is authoritative; clients interpolate. Goal: smooth movement at 2–5 Hz under artificial 1s lag. **Build the headless bot client here, not later** — it's the only way to test smoothness under lag (and, in Phase 2, population) without real humans, and it doubles as the load harness. **Instrument egress and tick-time from the first commit** — the whole feasibility case (§7) is a bandwidth argument you can't tune without measuring it.

**Phase 1 — The build loop (prove the fun).**
Add the piece state machine (ghost → placed), resource pickup/transport, and basic assembly. Include at least one **two-robot** assembly step to validate cooperation under lag. One small contract with a visible completion state. Goal: building together feels satisfying.

**Phase 2 — Scale the population (prove the architecture).**
Add chunks with per-chunk caps, interest-managed subscriptions, the OSHA checkpoint handoff, and queue-when-full. Load-test with the headless bot client built in Phase 0 (scaled up, à la the Phoenix/Tsung approach) to find the real per-box ceiling. Add the lightweight **spectator view + soft voting**. Goal: hundreds of concurrent participants on one structure, stable.

**Phase 3 — Identity & stickiness (prove retention is earned).**
Persist robots, certifications (with the online-only active-grant rule), crew patches with the apprenticeship/synergy bonuses, plaques on completed sections, and the ability to revisit a finished structure. Add the tourist/klepto aliens as the first "slapstick" system. Goal: players feel the world is *theirs*.

Everything else (maintenance contracts, shader upgrades, black-market economy, WebTransport fast path, multi-box distribution) is post-PoC.

---

## 10. Risks & Open Questions

- **Egress at the top end.** The 1 Gbps wall (§7.2) is real for 10k players. Decide early whether the headline target is "hundreds, comfortably" (one box) or "many thousands" (fatter pipe + fan-out), since it affects hosting budget.
- **Two-robot assembly under lag.** Cooperative actions with a 1s budget need careful reservation/timeout design so a piece doesn't get "stuck" if one robot disconnects mid-action. Sketch: a piece moves `reserved (robot A)` → `awaiting partner` (with a TTL) → `in_progress (A + B)` → `placed`; any disconnect or TTL expiry releases the piece back to `ghost`. The reservation TTL is the same mechanism as connection resilience (§4.7). Prototype this in Phase 1, not later.
- **Certification active-grant churn.** "Capability appears/disappears as people log in and out" is a great feel but a fiddly state-sync problem. Keep the active-grant table in Redis with clear ownership and TTLs; in-progress users keep the tool, new grabs don't.
- **Chunk handoff seams.** Moving a player between sim servers must not drop their carried item or queued action. The checkpoint metaphor helps (it's a natural pause point), but test it under load.
- **Reconnection is the common case, not an edge case.** On the target hardware (pillar #1), sockets drop constantly. The grace-period / resume / TTL design (§4.7) must be built and tested early — a flaky-connection player who loses their carried item or finds their robot frozen on every drop will churn immediately.
- **Anti-grief on voting.** Soft/majority voting reduces trolling, but define the threshold and cooldowns before spectators arrive in Phase 2.
- **Node vs. Elixir timing.** If load tests in Phase 2 show Node straining well below target, that's the signal to evaluate the Phoenix port before piling on features.

---

## 11. References (verified June 2026)

**Concurrency / server scale**
- The Road to 2 Million WebSocket Connections in Phoenix — phoenixframework.org/blog/the-road-to-2-million-websocket-connections
- Reproduction at 2.3M connections — github.com/dsander/phoenix-connection-benchmark
- Large Minecraft network architecture (proxy + world servers + shared DB) — quora.com/How-does-a-large-Minecraft-server-network-work
- WorldQL / Mammoth, 1000+ cross-server players — worldql.com

**Transport**
- WebSocket browser support (99%+, stable since 2013) — websocket.org/reference/browser-support/
- WebTransport reaches Baseline, March 2026 — webrtc.ventures/2026/04/webtransport-is-now-baseline-what-it-means-for-real-time-media/
- WebTransport browser support detail — testmuai.com/learning-hub/webtransport-browser-support/
- WebSocket vs WebTransport, 2026 guidance — techbytes.app/posts/webtransport-vs-websockets-low-latency-streaming-2026/

**Serialization**
- Binary serialization formats benchmark (MessagePack/Protobuf/FlatBuffers) — medium.com/@shekhar.manna83/binary-serialization-formats-e2703f053010
- FlatBuffers benchmarks (game-data oriented) — flatbuffers.dev/benchmarks/

**Rendering**
- PixiJS introduction — pixijs.com/8.x/guides/getting-started/intro
- PixiJS v8 launch (WebGL ~95% support; WebGL recommended for production) — pixijs.com/blog/pixi-v8-launches
- PixiJS news (v8.16 experimental Canvas fallback) — pixijs.com/blog

**Genre / precedent**
- Reddit r/place (rate-limited mass collaboration, ~10M users) — en.wikipedia.org/wiki/R/place
- Minecraft per-player bandwidth planning (~50–100 KB/s active) — operator planning estimates, 2026

---

*Prepared as a living document — expect the protocol schema, data model, and per-box capacity numbers to firm up against real Phase 0–2 load tests.*
