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

Phase 0 complete (this document, plus repo/collab scaffolding). **Next: Phase 1 — Prototype Architecture & Scaffolding.**

Per execution rules, implementation will proceed one phase at a time with explain → implement → test → typecheck/lint → review against report → fix → update this plan → summarize → stop for approval, before moving to Phase 2.
