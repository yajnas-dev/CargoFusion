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
| Claude API | **Deviation (user-directed, Phase 10): Gemini API** (`@google/genai`, `gemini-flash-latest`) instead of Claude, used only for: NL request interpretation, ambiguity/escalation judgment, and explanation generation | The role matches spec exactly — the model never computes routes/scores — but the provider does not. See the Phase 10 deviation note below for why and how to swap back. |
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

Phase 0 through 15 complete. **Next: Phase 16 — End-to-End Demo Testing.**

### Phase 15 summary

- `src/simulation/DemoControls.ts` — one-shot operator actions matching report section 13/5 exactly: block/unblock a lane, spike or drift congestion, reset congestion, move equipment (to an explicit node or a random neighbor), set/flap equipment availability, trigger an RFID checkpoint event. Uses plain `Math.random()` (unlike the Phase 3 dataset generator's seeded RNG) — live demo interactions don't need to be reproducible across runs, only the initial dataset does.
- `src/simulation/SimulationEngine.ts` — interval-driven background `tick()` that randomly performs one of: equipment movement, congestion drift (small random walk across all lanes, not a one-off spike), an equipment availability flap, or an RFID event. **Deliberately opt-in**: `start()`/`stop()`/`isRunning()` are the only way it runs — it never starts itself on module load, specifically so it can't reintroduce the kind of test/dev-session interference found in Phase 9's flaky-test bug.
- New `simulation/` module boundary documented in CONTRIBUTING.md.
- API routes (`src/app/api/simulation/`): `start`, `stop`, `status`, and one route per demo control (`congestion`, `block-lane`, `unblock-lanes`, `move-equipment`, `rfid-event`, `equipment-status`).
- Dashboard: a new "Simulation Controls" panel with a Start/Stop toggle for the background engine plus one button per one-shot control, all wired through the existing `runAction` helper and the existing 8s polling loop — no new UI plumbing needed since Phase 14 already refreshes the Yard Overview stats that these controls visibly move.
- **Real visual verification** (Playwright/Chromium, same standalone QA setup from Phase 14): confirmed live that Block Random Lane moves "Blocked lanes" 0→1, Simulate Congestion Spike moves "Avg congestion" up, Flap Equipment Availability moves "Equipment available" down by one, starting the background simulator further drifts congestion over ~9s of real polling, and Unblock All Lanes resets blocked lanes back to 0 — all with zero browser console errors.
- Test coverage: `DemoControls` — each control's specific effect (explicit lane/equipment targets, clamping behavior, the "no candidates left" null case); `SimulationEngine` — `start()`/`stop()`/idempotent-`start()` behavior under fake timers, and a 25-tick stress test asserting congestion stays within `[1, 3]` and every equipment's `currentNodeId` still references a real yard node throughout. Both test files snapshot and restore every row they touch, following the established pattern for tests that mutate shared seeded data.
- `npm run test` (86 passing + 1 skipped when Gemini quota-limited), `npm run typecheck`, `npm run lint`, `npm run build` all pass.

### Phase 14 summary

- **API layer** (`src/app/api/`): thin route handlers wiring every prior phase together — `POST /api/retrieval-requests` (interpret → persist → explain, the full report section 5 flow in one call), `GET/POST /api/tasks[/[id]]` and its action sub-routes (`approve`, `reject`, `override`, `dispatch`, `start`, `confirm`, `complete`), `GET /api/yard`, `GET /api/workers[/[id]/active-task]`. Verified Next.js 16's async route-params signature (`{ params: Promise<{ id: string }> }`) compiles and works correctly.
- **Dashboard** (`src/app/page.tsx`): yard overview (active tasks, equipment availability, blocked lanes, average congestion, per-block container counts), a single free-text retrieval-request input (natural language or a bare container id — both go through the same interpret step), a recommendation panel (container, equipment + score, route + ETA, twin validation, confidence breakdown), an approval panel (Approve/Reject/Override, with Override offering the runner-up equipment candidates from the same request), and a live task-tracking table.
- **Worker app** (`src/app/worker/page.tsx`): a worker picker plus a single-active-task view with Start/Confirm actions, matching the report's "minimal, single active task" design constraint (section 16) rather than building out a full separate mobile client.
- **Resilience**: `src/agents/fallback.ts` provides deterministic stand-ins for `RequestInterpreter`/`PlanExplainer` when Gemini is unavailable (no key, network error, or rate limit — all three were hit for real during this project). The API route catches Gemini failures and falls back rather than erroring the request.
- **Bug found via live smoke-testing, not unit tests**: the first fallback implementation used the *entire* raw sentence as the container search query, so a natural-language request like "Retrieve OOLU0187810 as quickly as possible" failed to match anything once quota exhaustion forced the fallback path (confirmed live — see below). Fixed by extracting an ISO-6346-shaped token (4 letters + 6-7 digits) from the sentence, with a keyword-based urgency heuristic (`urgent`/`asap`/`quickly`/etc.) as a secondary improvement. Added `src/agents/fallback.test.ts` to lock this in.
- **Verification, round 1 (functional)**: `chromium-cli` (the standard browser-driving tool for this environment) was not available, so this round used a full curl-driven functional smoke test of every route the UI calls instead of a visual/screenshot check — disclosed explicitly rather than claimed as a browser test. Exercised live against the running dev server: submitted a real natural-language request → got a `READY` plan with `HIGH` confidence → approved → dispatched → started → confirmed → completed, checked the resulting audit trail (`REQUEST_SUBMITTED → RECOMMENDATION_GENERATED → APPROVED → DISPATCHED → STATUS_CHANGED → WORKER_CONFIRMED → STATUS_CHANGED`).
- **Verification, round 2 (actual visual browser check)**: at the user's request, installed Playwright + Chromium standalone (in the scratchpad, not as a project dependency — this is QA tooling, not something the app needs) and drove the running dev server headlessly with screenshots at each step. This is a genuine visual check, not a substitute — confirmed the yard overview, recommendation panel (including the live confidence factor breakdown), approval buttons, task-tracking table, and the worker app's single-task card with its Start/Confirm buttons all render with real data and correct layout. Zero browser console errors at any step.
  - **Bug found by this check**: after `confirmRetrieval()` frees a worker (sets them back to `AVAILABLE`), the worker app's `<select>` dropdown kept showing their status as `(BUSY)` for the rest of the session — the worker list was only ever fetched once on mount. Fixed by polling `/api/workers` on the same 5s interval as the active-task check; re-verified live that the label updates correctly without a page reload.
  - Local `dev.db` was reseeded after both verification rounds to restore pristine demo state (it's gitignored, so no repo impact either way).
- Two React strict-lint fixes required by `eslint-config-next`'s current `react-hooks` rules: deferred the initial data-fetch-on-mount calls (`setTimeout(fn, 0)`) so they're not flagged as synchronous `setState`-in-effect, and replaced `<a>` tags with `next/link`'s `Link` for internal navigation.
- `npm run test` (75 passing + 1 skipped when Gemini quota-limited), `npm run typecheck`, `npm run lint`, `npm run build` all pass.

### Phase 13 summary

- `src/worker/WorkerTaskService.ts` — new `worker/` module boundary (CONTRIBUTING.md updated); completes the `Task` state machine Phase 12 left partially covered: `dispatch()` (APPROVED → DISPATCHED, assigns the first `AVAILABLE` worker, marks them `BUSY`), `startTask()` (DISPATCHED → IN_PROGRESS), `confirmRetrieval()` (→ RETRIEVED, frees the worker, updates the `Container` row), `completeTask()` (→ COMPLETED).
- `confirmRetrieval()` is the one place ACSA writes to `Container.status`/`retrievalEligible` — reasoned through explicitly in the code comment: report section 6.3 says ACSA never writes TOS master data, but that's describing a *real* TOS as a separate system; in this prototype the mock TOS *is* the local cache, so updating it here is the simulated equivalent of "the physical move got captured in the TOS's own audit trail and synced back" (section 6.1), not a violation of the read-mostly principle.
- Every transition is guarded (wrong status, wrong worker) and throws a descriptive error rather than silently no-op'ing; `getActiveTaskForWorker()` returns at most one task, matching the report's "Worker App... single active task" design constraint (section 16).
- Test coverage: a full lifecycle test (submit → approve → dispatch → start → confirm → complete) against the real seeded DB, asserting the worker/container state changes at each step *and* the complete ordered audit trail across both Phase 12 and Phase 13 actions in one sequence; plus two guard-rejection tests (dispatching a non-approved task, a worker acting on someone else's task).
- **Second flaky-test fix found while re-running the suite**: the live Gemini integration test started failing with `429 RESOURCE_EXHAUSTED` — a genuine free-tier daily quota limit (20 requests/day/model), hit from repeatedly re-running the full suite during this session, not a code defect. Made the test catch that specific error and call `ctx.skip()` (visible as skipped, not silently passed or falsely failed) rather than treating quota exhaustion as a test failure.
- `npm run test` (68 passing + 1 skipped when quota-limited, 69 passing when quota allows), `npm run typecheck`, `npm run lint`, `npm run build` all pass.

### Phase 12 summary

- `src/approval/SupervisorApprovalService.ts` — new `approval/` module boundary (documented in CONTRIBUTING.md); the only place that writes `Task`/`Recommendation`/`AuditEvent` rows. Everything through Phase 11 was ephemeral (computed per-call, nothing persisted) — this phase is where a plan first becomes a durable record a human can act on.
- `submitRequest()`: runs the Phase 9 pipeline, and only creates a `Task` if a container actually resolved (`Task.containerId` is a required FK — `AMBIGUOUS`/`NOT_FOUND` have nothing to attach it to). Even in that no-container case, a `REQUEST_SUBMITTED` audit event is still logged (with `taskId: null`), per report section 14's "log both permitted and denied" requirement. For a `READY` plan, also persists a `Recommendation` (route/equipment/confidence from Phases 6/7/11) and logs `RECOMMENDATION_GENERATED`.
- `approve()` / `reject()` / `override()`: each is a `Task.status` transition plus an `AuditEvent`. `override()` specifically captures report section 12's required fields — who (`actor`), why (`reason`), the original recommendation (equipment/route/confidence snapshotted from the DB, not re-derived), the new decision, and a timestamp — all in the audit event's `detailsJson`, and applies the new equipment assignment to the `Task`.
- The `explanation` field on `Recommendation` is left empty by this service — Phase 10's `PlanExplainer` output gets written there once the two are wired together at the API layer (a later phase); this phase's job was the persistence/workflow mechanics, not that wiring.
- **Flaky test found and fixed in passing**: the pre-existing live Gemini integration test (Phase 10) started timing out at its 30s limit under the fuller test suite (26.7s observed standalone, right at the edge) — real API latency variance, not a regression from this phase's changes. Bumped to 60s with a comment explaining the two-call (interpret + explain) budget; reran the full suite twice to confirm stability.
- Test coverage against the real seeded data: no-container path logs the audit event without a Task; a `READY` submission persists both rows and both audit events; approve/reject/override each verified via their resulting `Task.status`, audit action, and `detailsJson` contents (override specifically checked for the original-vs-new equipment capture).
- `npm run test` (66 passing, stable across repeated runs), `npm run typecheck`, `npm run lint`, `npm run build` all pass.

### Phase 11 summary

- `src/policy/ConfidenceGate.ts` — new `policy/` module boundary (documented in CONTRIBUTING.md). `assess()` takes a `READY` plan and returns a transparent composite score (0-1) plus a `HIGH`/`MEDIUM`/`LOW` `ConfidenceLevel` (reusing the Prisma enum from Phase 2's schema, not a new type), per report section 11.
- Three weighted factors, each independently visible in the output rather than folded into one opaque number: `searchConfidence` (0.35, from the Phase 5 match), `equipmentScore` (0.35, from the Phase 7 allocation score), `routeCongestionCertainty` (0.30, derived from the average `congestionWeight` across the Phase 6 route's edges — a stand-in for the report's congestion-forecast input, since a full time-series forecasting phase wasn't in this roadmap's scope).
- Thresholds: ≥0.8 HIGH, ≥0.5 MEDIUM, else LOW — round numbers, explicitly documented as an unvalidated prototype heuristic (report section 11's own caveat: "do not pretend the confidence score is scientifically validated").
- `isReadyPlan()` type guard narrows a `RetrievalPlanResult` to the fields the gate needs; only `READY` plans are gated; every other pipeline status already carries its own resolution path from Phase 9 (ambiguous → ask, not found/no equipment/no route/escalation → already flagged).
- Test coverage: the type guard's accept/reject behavior; three synthetic fixtures pinned to hit each of HIGH/MEDIUM/LOW exactly (verifying the threshold math, not just "some level came back"); a no-edge trivial-route case (maximally certain); and one assessment run against a real pipeline `READY` result from the seeded DB, checked for internal consistency (score in range, factors present) rather than a specific value.
- `npm run test` (61 passing), `npm run typecheck`, `npm run lint`, `npm run build` all pass.

### Deviation: Gemini instead of Claude for the agent layer

The report specifies Claude specifically for orchestration/disambiguation/explanation (sections 7.3, 8, 13), citing its multi-step tool-use reasoning. **The user explicitly directed a switch to Google's Gemini API instead**, after confirming they wanted this deviation from the report's spec (rather than holding Phase 10 until an Anthropic key was available). This is recorded here as a deliberate, requested departure from the source-of-truth architecture, not an oversight.

Practical notes from making the switch:
- `gemini-2.5-flash` (the model named in the report-era API listing) returns `404 ... no longer available to new users`; the prototype uses `gemini-flash-latest` instead.
- The agent layer depends on a small `GenerativeModelClient` interface (`generateJSON`/`generateText`), not `@google/genai` directly — implemented by `GeminiClient`. A future swap to Claude (or back) only touches that one file.

### Phase 10 summary

- `src/agents/GeminiClient.ts` — `GenerativeModelClient` interface + Gemini implementation using structured JSON output (`responseSchema`) for interpretation and plain text for explanation.
- `src/agents/RequestInterpreter.ts` — turns a natural-language request into `{ containerQuery, priority, requiredEquipmentType?, isAmbiguous, clarifyingQuestion? }` (report section 8's example: "container = MSKU1234567, objective = minimize retrieval time, priority = high"). The model only decides *what* to look up — it never computes anything.
- `src/agents/PlanExplainer.ts` — narrates an already-computed `RetrievalPlanResult` (container, selected equipment + score factors, route, twin validation) into 2-4 plain-language sentences for a supervisor. Every number in the prompt comes from Phases 5-9; the model doesn't compute or invent any of them.
- `src/agents/RetrievalAgent.ts` — orchestrates interpret → (short-circuit to a clarifying question if ambiguous, else) → `RetrievalPlanningPipeline.plan()` → explain. This is a two-structured-call design rather than a full autonomous multi-turn tool-calling loop — a deliberate prototype simplification; the report's "agent decides what to compute" principle still holds since the pipeline call is deterministic and unconditional once a container query is resolved.
- Test coverage is two-tiered: fast deterministic unit tests inject a `FakeModel` implementing `GenerativeModelClient` (no network) to verify orchestration wiring (ambiguity short-circuit skips the pipeline entirely; a resolved request runs the real Phase 9 pipeline against the seeded DB and reaches the explainer). A `describe.runIf(!!process.env.GEMINI_API_KEY)` block adds one genuine live-API integration test — it ran for real during this phase (confirmed via verbose reporter, ~8s wall time) and passed end-to-end: real Gemini interpretation of "retrieve X as soon as possible", real pipeline execution, real explanation text back from Gemini.
- `.env.example` updated: `GEMINI_API_KEY` replaces the placeholder `ANTHROPIC_API_KEY` line, with the deviation noted inline.
- `npm run test` (55 passing, including the live integration test since a key is configured), `npm run typecheck`, `npm run lint`, `npm run build` all pass.

### Phase 9 summary

- `src/pipeline/RetrievalPlanningPipeline.ts` — new `pipeline/` module boundary (documented in CONTRIBUTING.md), composing Phases 5-8 into one deterministic flow: search → resolve container → allocate equipment → compute route → validate against the digital twin. No AI involved, matching report section 5's flow minus the orchestration/approval steps that arrive in later phases.
- Container resolution rule: a single search match, or a top match at confidence 1.0 (an exact id), is treated as unambiguous and proceeds automatically; anything else (multiple non-exact candidates with no clear winner) comes back as `AMBIGUOUS` with all candidates attached, for Phase 10's Claude agent to disambiguate rather than the pipeline guessing.
- Self-correction: if the top-ranked equipment candidate fails digital-twin validation for a replannable reason (double-booked/unavailable — e.g. a concurrent request claimed it first), the pipeline automatically retries with the next-ranked candidate (up to 5 attempts) before giving up. A genuinely ESCALATE-worthy twin result (bad container state, missing equipment) stops the retry loop immediately rather than wasting attempts.
- Result statuses: `READY`, `AMBIGUOUS`, `NOT_FOUND`, `NO_EQUIPMENT`, `NO_ROUTE`, `NEEDS_ESCALATION` — every non-READY status still carries whatever partial data (matches, candidates, last attempted route/twin result) is available, so the UI/agent can explain what happened rather than just showing a failure.
- **Test infra fix**: found and fixed a real bug during this phase — Vitest was running test files in parallel by default, and several test files mutate shared rows (equipment status, task rows, lane `blocked` flags) in the same SQLite database with `afterEach` cleanup rather than per-test transactional isolation. Concurrent files raced against each other's fixtures, producing order-dependent false failures (reproduced, confirmed by running the failing file alone — it passed). Fixed via `fileParallelism: false` in `vitest.config.mts`, verified stable across repeated full-suite runs.
- Test coverage: a clean READY path, NOT_FOUND, AMBIGUOUS (a short owner-code-prefix query matching many containers), NO_EQUIPMENT (all yard trucks forced offline), and the self-correction retry (double-book the pipeline's own first-choice equipment mid-test, confirm the second run picks a different one and still succeeds) — all against the real seeded DB.
- `npm run test` (48 passing), `npm run typecheck`, `npm run lint`, `npm run build` all pass.

### Phase 8 summary

- `src/twin/DigitalTwin.ts` — `validatePlan()` checks a proposed plan (container + equipment + route) against live state, per report section 12's "feasibility check before accepting any plan."
- Conflict types checked: `CONTAINER_NOT_FOUND`, `CONTAINER_NOT_ELIGIBLE`, `CONTAINER_RESERVED` (another active task already holds it), `EQUIPMENT_NOT_FOUND`, `EQUIPMENT_UNAVAILABLE`, `EQUIPMENT_DOUBLE_BOOKED`, `LANE_BLOCKED`.
- Each result carries a `recommendedAction`: `PROCEED` (no issues), `REPLAN` (all issues are ones a fresh allocation/route pass could plausibly fix — unavailable/double-booked equipment, a blocked lane), or `ESCALATE` (anything touching container identity/eligibility, or missing equipment — not something a mechanical retry resolves).
- Re-validating an existing task's own plan excludes that task from the double-booking/reservation checks via an optional `taskId` on `PlanToValidate`, so a task doesn't conflict with itself.
- "Live state" here is read straight through `TOSAdapter` plus a direct query against ACSA-owned `Task` rows (same precedent as Phase 7's workload lookup) — no separate cached twin snapshot to keep in sync, since the mock TOS is itself always current. A real deployment would reconcile TOS-sync timestamps against IoT checkpoint recency here.
- Test coverage against the real seeded data: clean plan proceeds; unknown ids escalate; ineligible container escalates; equipment already committed to another task replans; a task validating against its own existing reservation is not flagged; a blocked lane on the route replans.
- `npm run test` (43 passing), `npm run typecheck`, `npm run lint`, `npm run build` all pass.

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
