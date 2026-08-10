# ACSA Prototype — Implementation Plan

Source of truth: `Autonomous-Container-Search-Assistant-Engineering-Report-Combined.docx` (extracted to `report.txt` for reference). This plan translates that report's target architecture into a **local, single-operator, demo-ready prototype**. It is not the production architecture — see "Prototype vs. Report" below for what is deliberately simplified.

---

## Phase 0 — Repository Assessment

**Finding:** The directory contains only the engineering report (`.docx`). There is no existing code, no `package.json`, no git repository. This is a greenfield prototype build.

**Decision:** Initialize a git repo and a single deployable application rather than a multi-service system, per the "do not overbuild" directive.

---

## Prototype vs. Report — What's Simplified and Why

| Report component | Prototype approach | Reason |
|---|---|---|
| Node (NestJS) API + Python (FastAPI) AI/optimization split | Single **Next.js (TypeScript) app**, API routes for backend, plain TS modules for optimization | Avoids two-runtime deployment/orchestration for a solo local demo; A*/scoring algorithms are simple enough in TS that Python/OR-Tools adds no real capability for this scale |
| Kubernetes + Terraform | `npm run dev`, no containers required | Explicitly excluded by spec |
| Kafka | In-process **event emitter bus** (`EventBus` module) with the same publish/subscribe topic shape Kafka would have, so it's replaceable later | Spec allows "lightweight simulated event bus" |
| PostgreSQL + Redis + TimescaleDB | **SQLite** (via `better-sqlite3` or Prisma) as the single local datastore, with an in-memory hot-path map standing in for Redis | Spec explicitly allows skipping Redis/Postgres if not needed; SQLite keeps the prototype zero-install |
| OR-Tools (Python constraint solver) | Deterministic **weighted scoring function** in TS for equipment allocation (distance, availability, workload, priority) | OR-Tools is a real dependency-management burden for a prototype; report itself allows "deterministic scoring **or** OR-Tools if appropriate" |
| A* / Dijkstra | Implemented directly in TS over the synthetic yard graph | Matches spec exactly, no simplification needed |
| Claude API | Anthropic SDK, used only for: NL request interpretation, ambiguity/escalation judgment, and explanation generation | Matches spec exactly — Claude never computes routes/scores |
| Real RFID/GPS/crane hardware | `SimulatedSensorProvider` emitting synthetic events on a timer, behind a `SensorProvider` interface | Spec requirement |
| Real TOS (Navis/Tideworks) | `MockTOSAdapter` implementing a `TOSAdapter` interface | Spec requirement |
| Kubernetes-managed WebSocket fanout | Socket.IO (or native WS) server co-located in the Next.js app | Enough for a local multi-tab demo (dashboard + worker view) |

Interfaces (`TOSAdapter`, `SensorProvider`) are kept literal so a real adapter could later be swapped in without touching calling code — this satisfies the "modular, replaceable" requirement without building the real integrations.

---

## Phase-by-Phase Roadmap

### Phase 1 — Prototype Architecture & Scaffolding
Set up the Next.js (TS) app skeleton, folder structure mirroring the layered architecture (`domain/`, `adapters/tos/`, `adapters/sensors/`, `optimization/`, `agents/`, `twin/`, `events/`, `app/` for routes/UI), linting, testing framework (Vitest), and the interface definitions (`TOSAdapter`, `SensorProvider`, `EventBus`) with no implementations yet. Deliverable: project builds, empty interfaces compile, `docs/PROTOTYPE_IMPLEMENTATION_PLAN.md` cross-linked from a root `README.md`.

### Phase 2 — Domain Model & Database
Define TS types/schema for Container, Equipment, YardBlock/Lane/Node, Worker, Task, Recommendation, AuditEvent. Set up SQLite + a thin data-access layer (Prisma or Kysely). This is the "PostgreSQL local system of record" from the report, scaled to SQLite.

### Phase 3 — Synthetic Data Generator
Deterministic-seed generator producing ~1,000+ containers, ~100+ equipment, a yard graph (blocks/intersections/lanes/distances), and workers. Output written into the Phase 2 database. Reproducible via a fixed seed constant.

### Phase 4 — Mock TOS Adapter
`MockTOSAdapter implements TOSAdapter` backed by the Phase 3 data: `searchContainers()`, `getContainer()`, `getEquipment()`, `getYardState()`, `getEvents()`, `writeRecommendation()`. This becomes the only place "TOS" is touched, per the report's adapter-isolation principle.

### Phase 5 — Container Search
Cache-first lookup (in-memory map) with fallback to the mock TOS "query," fuzzy matching for near-miss container IDs, confidence scoring on match quality.

### Phase 6 — Yard Graph + A*
A* pathfinding over the Phase 3 graph, congestion-weighted edges, blocked-lane handling, returns path/distance/ETA.

### Phase 7 — Equipment Allocation
Deterministic weighted-scoring allocator: distance to container, availability, equipment type fit, current workload, task priority. Returns selected equipment + score breakdown (for later explanation).

### Phase 8 — Digital Twin
In-memory reconciled state (containers, equipment, workers, lanes, active tasks, congestion) updated from TOS syncs and simulated sensor events. Plan validation function: detect conflicts (double-booked equipment, blocked lane, stale container position) → REPLAN or ESCALATE signal.

### Phase 9 — Retrieval Planning Pipeline
Wires Phases 5–8 into one pipeline: search → candidate generation → route → equipment → twin validation → structured plan object, without AI involved yet (deterministic core proven independently first).

### Phase 10 — Claude Agent Orchestration
Anthropic SDK integration: interpret NL retrieval requests into structured goals, invoke the Phase 9 pipeline as tools, generate the human-readable plan explanation, flag ambiguity for escalation. Claude never touches numbers directly — it calls tools and narrates results.

### Phase 11 — Confidence / Policy Gate
Transparent scoring function combining twin-validation result, search-match confidence, allocation score, and forecast/congestion certainty into HIGH/MEDIUM/LOW with visible contributing factors.

### Phase 12 — Supervisor Approval Workflow
Approve/Reject/Override actions, override capture (who/why/original vs. new decision/timestamp), all recorded to an audit log table.

### Phase 13 — Worker/Task Simulation
Worker-facing view showing the single active dispatched task; confirm-retrieval action; task status state machine (Requested → Planned → Approved → Dispatched → In Progress → Retrieved → Completed).

### Phase 14 — Dashboard
Yard overview (blocks/containers/equipment/congestion/active tasks), retrieval request input, recommendation panel, approval panel, task-tracking view — all wired to the real pipeline via the API routes and WebSocket push for live updates.

### Phase 15 — Real-Time Simulation & Demo Controls
Simulation engine (interval-driven truck movement, congestion drift, equipment availability flaps) plus explicit demo-operator controls (simulate congestion, block lane, move equipment, RFID event, make equipment unavailable) so the live-adaptation story is demonstrable on demand, not just passively simulated.

### Phase 16 — End-to-End Demo Testing
Scripted run-through of the full scenario in section 2 of the brief (NL request → ... → completed retrieval → dashboard + audit trail), plus a written demo script for presenting it.

---

## Dependency Rationale for Ordering

Data (Phase 2–3) must exist before anything can search or plan against it. The TOS adapter (4) must exist before search (5) because search is defined as querying it. Route (6) and equipment (7) are independent of each other and could be built in parallel, but are sequenced for clarity. The digital twin (8) needs both route and equipment concepts to validate against. The deterministic pipeline (9) must work and be testable *before* adding Claude (10), so failures can be isolated to either the deterministic core or the AI layer. The policy gate (11) needs confidence inputs that only exist once the AI layer produces them. Approval (12) and worker simulation (13) depend on there being a plan to approve and dispatch. The dashboard (14) is deliberately late because it should visualize a working pipeline, not scaffold ahead of one. Live simulation controls (15) are layered on top of a working end-to-end flow so their effects are visibly meaningful in the UI already built.

---

## Multi-User Collaboration

The repo is initialized for multiple contributors: git repo with remote `origin` at `https://github.com/yajnas-dev/CargoFusion.git`, `.gitattributes` normalizing line endings across OSes, and [`CONTRIBUTING.md`](../CONTRIBUTING.md) defining branching/PR/review conventions and module ownership boundaries. Recommended (not yet enforced remotely): branch protection on `main` requiring PR + 1 approval, configured via GitHub repo settings.

## Current Status

Phase 0 through 7 complete. **Next: Phase 8 — Digital Twin.**

### Phase 7 summary

- `src/optimization/EquipmentAllocationService.ts` — deterministic weighted-scoring allocator per report section 8.1/13 (distance, availability, capacity fit, current workload; priority reweights the factors). No OR-Tools dependency and no LLM involvement — a plain scoring function is sufficient at this scale, as the report allows ("deterministic scoring **or** OR-Tools if appropriate").
- Hard filters (not scored, simply excluded): equipment type must match, status must be `AVAILABLE`, capacity must be ≥ the container's weight, and the equipment must actually be reachable on the yard graph (reuses Phase 6's `RouteOptimizationService`, so distance-to-container comes from real A* output, not a straight-line guess).
- Scored factors: `distanceScore` (closer is better, normalized against an illustrative max-yard-traversal distance), `capacityFitScore` (penalizes using an oversized crane/truck for a light container), `workloadScore` (derived from a live count of the equipment's active — `APPROVED`/`DISPATCHED`/`IN_PROGRESS` — tasks, not just its `AVAILABLE`/`BUSY` status flag).
- Priority reweighting: `HIGH`/`URGENT` requests weight distance at 0.6 (vs. 0.4 normally), trading off capacity-fit precision for faster response — a deliberately simple, transparent rule rather than a tuned model.
- Every candidate is returned with its full score breakdown (not just the winner), so the UI/policy gate can show *why* one piece of equipment was chosen over the alternatives.
- Test coverage against the real seeded data: eligibility filtering (type/availability/capacity), ranking order, priority-based reweighting, and a workload test that creates a real active `Task` row and confirms it lowers that equipment's score.
- `npm run test` (37 passing), `npm run typecheck`, `npm run lint`, `npm run build` all pass.

### Phase 6 summary

- **Yard topology change (retroactive to Phase 3's seed):** the original graph was a pure tree (spine + leaf block entries) with exactly one path between any two points, so a blocked lane could only strand traffic, never trigger a real reroute. Added lateral aisle lanes between adjacent block entries in the same row (8 extra lanes, 15 → 23 total) so Phase 15's "block a lane" demo control has an actual alternate route to demonstrate.
- `src/domain/constants.ts` — `LANE_SCALE_METERS` factored out of the seed script so the A* heuristic uses the exact same units-to-meters scale as the seeded lane distances (required for the heuristic to stay admissible).
- `src/optimization/YardGraph.ts` — in-memory graph built from `TOSAdapter.getYardState()`; lanes are undirected (either direction of travel).
- `src/optimization/astar.ts` — A* with edge cost `distanceMeters * congestionWeight`, blocked lanes excluded, straight-line-distance heuristic. Deterministic; no LLM involvement, per report section 13.
- `src/optimization/RouteOptimizationService.ts` — wires `TOSAdapter` → `YardGraph` → `findPath`, adds a simple constant-speed ETA calculation.
- Test coverage: synthetic 4-node cycle graph proves reroute-around-a-blocked-lane and congestion-aware detour selection (picks the physically longer path when the direct lane's weighted cost is higher) precisely; integration tests against the real seeded graph prove the same behavior end-to-end, including a lane-blocking test that mutates the DB and confirms the computed route changes.
- `npm run test` (33 passing), `npm run typecheck`, `npm run lint`, `npm run build` all pass.

### Phase 5 summary

- New `src/search/` module (added to the module-boundary list in `CONTRIBUTING.md`) — deterministic search/matching logic doesn't fit `optimization/` (route/scheduling algorithms) or `agents/` (orchestration-only), so it gets its own boundary.
- `ContainerSearchService`: cache-first lookup (in-memory `Map`, standing in for the Redis hot path from report section 7.2) with fallback to `TOSAdapter.searchContainers()` on a cache miss, per report section 8.1's Container Search agent spec.
- Three-tier matching, all deterministic (`src/search/levenshtein.ts` for edit distance — no LLM involved): exact id (confidence 1.0) → substring (confidence scaled by query/id length overlap) → fuzzy (shrinking-prefix candidate search, ranked by Levenshtein distance, capped at edit distance 2).
- Every match carries a transparent `confidence` (0-1) and `matchType`, ready to feed the Phase 11 policy gate.
- Test coverage against the real seeded DB: empty query, exact match warms the cache and is served from it on repeat, substring matching, fuzzy recovery of a single-character typo, no-match case, cache growth.
- `npm run test` (24 passing), `npm run typecheck`, `npm run lint`, `npm run build` all pass.

### Phase 4 summary

- `src/adapters/tos/MockTOSAdapter.ts` implements `TOSAdapter` against the Phase 3 seeded database via the shared Prisma client — the only module permitted to represent "the TOS," per report section 6.1.
- `searchContainers` tries an exact-id match first, then falls back to a case-insensitive substring match (capped at 20 results) — a placeholder for the real fuzzy-match/disambiguation logic that lands with the Container Search agent in Phase 5.
- `getEquipment(id?)` returns a single match or the full roster; `getYardState()` composes blocks/nodes/lanes into the `YardState` read shape with a sync timestamp.
- `getEvents`/`emitEvent` simulate the TOS's optional gate/crane move event stream in memory (report section 6.1) — a real event source arrives with the Phase 15 simulation engine; not persisted, since nothing downstream needs cross-run event history yet.
- `writeRecommendation` simulates TOS write-back by recording what was sent, never touching container/equipment master data — matches the read-mostly, write-only-for-recommendations design in section 6.
- Test coverage against the real seeded DB (not mocked): exact/fuzzy container lookup, equipment lookup (single + all), yard-state composition, event emit/filter-by-`since`, and recommendation write-back recording.
- `npm run test` (18 passing), `npm run typecheck`, `npm run lint`, `npm run build` all pass.

### Phase 3 summary

- `src/domain/seed/rng.ts` — a seeded PRNG (mulberry32) plus `pick`/`randInt`/`shuffle` helpers, reusable later by the simulation engine (Phase 15) so live-demo randomness stays reproducible too.
- `prisma/seed.ts` — deterministic generator (fixed `SEED = 42`) producing: a 16-node/15-lane yard graph (gate + 5-column spine + 10 block entries across a 2-row layout), 110 equipment (20 cranes + 90 yard trucks) placed on graph nodes, 1,200 containers (exceeds the 1,000+ target) with unique block/row/bay/tier slots and realistic status/priority/type/destination distributions, and 40 workers.
- Re-running `npm run db:seed` clears and regenerates identically — verified counts and leading records are byte-identical across two runs.
- `npm run db:seed` registered as a script; `prisma.config.ts` also wires it as the `migrations.seed` hook for `prisma migrate reset`.
- Test coverage: `src/domain/seed/rng.test.ts` (determinism of the PRNG itself) and `prisma/seed.test.ts` (shape/scale/FK-integrity assertions against the actual seeded database, not mocks).
- `npm run test` (11 passing), `npm run typecheck`, `npm run lint`, `npm run build` all pass.

Note for contributors: `npm run db:seed` must be run once after `npm run db:migrate` to populate demo data (documented in README).

### Phase 2 summary

- Full domain model defined in `prisma/schema.prisma`: `Container`, `Equipment`, `YardBlock`/`YardNode`/`YardLane` (yard graph), `Worker`, `Task`, `Recommendation`, `AuditEvent`, `SensorEvent`, plus supporting enums (`ContainerStatus`, `TaskStatus`, `ConfidenceLevel`, etc.) matching the task-status state machine and confidence levels from the report.
- SQLite database (`dev.db`, gitignored) with an initial migration (`prisma/migrations/`, tracked in git so all contributors apply the same schema).
- Prisma 7 driver-adapter setup (`@prisma/adapter-better-sqlite3`) — schema-level `datasource.url` is no longer supported in Prisma 7, so the connection is configured in `prisma.config.ts` (for migrations) and `src/domain/db.ts` (for the app's shared client singleton).
- `src/domain/types.ts` now re-exports the generated Prisma types (superseding the Phase 1 placeholders), plus two non-Prisma read shapes (`YardState`, `TOSEvent`) used by `TOSAdapter`.
- `.env.example` documents `DATABASE_URL` (and reserves `ANTHROPIC_API_KEY` for Phase 10).
- `npm run postinstall` runs `prisma generate` automatically so a fresh clone only needs `npm install` + `npm run db:migrate`.
- Test coverage added: a Container create/read round-trip and a Task→Container foreign-key constraint check, both passing against the real SQLite database (not mocked).
- `npm run test`, `npm run typecheck`, `npm run lint`, `npm run build` all pass.

### Phase 1 summary

- Next.js 16 (App Router, TypeScript, Turbopack) scaffolded via `create-next-app`, merged into the repo root (`src/app/`).
- Layered folder structure created: `src/domain/`, `src/adapters/tos/`, `src/adapters/sensors/`, `src/optimization/`, `src/agents/`, `src/twin/`, `src/events/`.
- Interfaces defined (no implementations yet, per plan): `TOSAdapter` (`src/adapters/tos/TOSAdapter.ts`), `SensorProvider` (`src/adapters/sensors/SensorProvider.ts`), `EventBus` (`src/events/EventBus.ts`), plus placeholder domain types (`src/domain/types.ts`) to be superseded in Phase 2.
- Vitest configured (`vitest.config.mts`) with a `@/*` alias matching `tsconfig.json`; smoke test confirms the interfaces compile and are importable.
- `npm run test`, `npm run typecheck`, `npm run lint`, `npm run build` all pass.
- `package.json` scripts: `dev`, `build`, `start`, `lint`, `test`, `typecheck`.

Per execution rules, implementation will proceed one phase at a time with explain → implement → test → typecheck/lint → review against report → fix → update this plan → summarize → stop for approval, before moving to Phase 2.
