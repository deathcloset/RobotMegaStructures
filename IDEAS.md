# Ideas & Brainstorm — *fuel, not roadmap*

Per design doc **§2.5**: the long-term vision keeps the fiction coherent and guides
our *structure*; it is **not** a build commitment. We jot ideas here so they're not
lost, and let each phase decide what (if anything) graduates into the plan.

---

## Living megastructures — maintenance hosting (post-completion)

When a megastructure is finished it shouldn't just blink out of existence.

- A **completed-structure hosting mode**: a finished megastructure stays "alive"
  and accepts a *small* number of robots (~**100** cap) taking **maintenance jobs**
  — upkeep. It **needs** that upkeep to stay healthy, giving players a reason to
  return to things they built.
- Deliberately **bandwidth-light** (few bots, slow cadence) so a single server can
  host **one active build + several completed structures** cheaply.
- This is the cheap bridge toward the "Live" level (§2.5, level 2) *without*
  building the full life-sim yet: structures persist and generate standing work, so
  building never truly "ends."
- Engine fit (so it's near-free later): a completed structure is just a chunk /
  contract in a `complete` state with a maintenance-job generator on top; the
  entity-neutral chunk + interest layers already carry it. The real prerequisite is
  **durable persistence** (Postgres archive of completed structures, pillar #5) —
  that's Phase 3 territory.

## Distributed hosting — sections across servers (Ben, 2026-06-21)

The chunk grid (a megastructure divided into sections) is built to become a
**distributed** thing: each section can live on its own server, so a megastructure
is hosted cooperatively across many boxes — even tiny ones. Ben's framing:

- A **small server hosts a small section** — e.g. enough for ~8 bots to work that
  part of the structure. Hosting scales by adding cheap boxes, not big ones.
- A section is **offline only if no compute/capacity is available** for it — the
  default is "as much of the megastructure as the fleet can host is live." When a
  hosting server drops, its section could be **subsumed by a spare/standby server**
  (if that option is enabled), so the structure stays as whole as the fleet allows.
- This rides the design's §4.4/§4.5 path: the OSHA checkpoint **is** the sharding
  boundary, cross-section handoff becomes a network handoff, and a Redis/Valkey
  pub/sub bus + a chunk-ownership registry coordinate which server owns which
  section. Capacity/failover policy (who subsumes an orphaned section, when to take
  one offline) is the orchestration layer on top.
- Engine fit (so it's near-free later): we keep each `Chunk` a clean message-in /
  state-out unit and route everything through `ChunkRegistry`, so "the registry
  hands a chunk to another process/box" is a swap of that one indirection — not a
  rewrite. We deliberately **don't** build the multi-box distribution until the
  single-box grid is proven (§2.5): no Redis, no ownership protocol on spec.

## The "megastructures" game-set (north star)

We're implicitly building toward an **interconnected set of "megastructures"
games** that share identity / persistence / engine — *modes of one engine, not
separate products* (§2.5). We commit only to the **foundational** one:
**robot construction** (building the megastructures). Working-title space —
"Robot Mega Structures" / "Robot Construction Megastructures" / *find something
better* 😉. The other levels (live-in arcology, terraform/farm, interstellar) stay
**fuel**, reached only if earned.

## Optional robot personalities (flavor)

Homage to the **Sirius Cybernetics Corporation's "Genuine People Personalities"**
(Hitchhiker's Guide). Our default construction crews are relentlessly **chipper** —
none of Marvin's gloom. Idea: make a "real personality" mode an **opt-in** toggle
(chipper by default), so personality is delight a player can dial up, never a
mandate. Low priority, pure flavor.

---

_Add freely. Graduating an idea into the plan is a deliberate, per-phase choice._
