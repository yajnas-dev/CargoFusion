# ACSA Prototype — Demo Script

A presenter's walkthrough of the primary demo scenario (report section 2 / prototype brief section 2): a natural-language retrieval request flowing through simulated TOS lookup, deterministic optimization, AI orchestration, digital-twin validation, the confidence gate, human approval, simulated dispatch, worker confirmation, and completion — with a full audit trail.

Total time: ~5 minutes for the core flow, ~10 with the simulation-controls detour.

## Before you present

```bash
npm install
cp .env.example .env   # add GEMINI_API_KEY if you have one — see note below
npm run db:migrate
npm run db:seed
npm run dev
```

Open **http://localhost:3000** (dashboard) and, in a second tab, **http://localhost:3000/worker** (worker app).

Get a real container id to use: `npm run db:studio`, open the `Container` table, filter `status = IN_YARD` and `retrievalEligible = true`, copy any id. (Or just trust that most seeded ids work — ~1,200 containers, mostly `IN_YARD`.)

**If you don't have a `GEMINI_API_KEY`, or the demo hits a rate limit mid-presentation:** don't panic, don't apologize at length — the app is built for this. It falls back to a deterministic interpreter/explainer (`src/agents/fallback.ts`) automatically and the flow keeps working. Talking point: *"The AI layer degrades gracefully — this is exactly the kind of resilience the report calls for in section 19's risk analysis: confidence/policy routing and fallback behavior when the LLM layer has issues."*

## The walkthrough

### 1. Orient on the dashboard (30s)

Point at **Yard Overview**: active tasks, equipment availability, blocked lanes, average congestion, per-block container counts. *"This is the digital twin's current read of the yard — reconciled from the simulated TOS."*

### 2. Submit a retrieval request (30s)

In **Retrieval Request**, type either:
- A bare id: `OOLU0187810` (use your own real id), or
- Natural language: `Retrieve OOLU0187810 as quickly as possible`

Click **Submit**. Narrate while it loads: *"This goes to Gemini first to interpret the request — extract the container and infer priority — then a fully deterministic pipeline takes over: cache-first search, A* routing over the yard graph, equipment allocation scoring, and digital-twin conflict validation. The LLM never computes a route or a score — it only decides what to look up and explains the result afterward."*

### 3. Read the Recommendation panel (45s)

Point out each piece and what produced it:
- **Container** location — Phase 5 (cache-first search, TOS-synced).
- **Equipment** + score — Phase 7 (deterministic weighted scoring: distance, capacity fit, workload).
- **Route** + ETA — Phase 6 (A* over the congestion-weighted yard graph).
- **Digital twin: PROCEED** — Phase 8 (conflict check against live task/equipment state).
- **Confidence: HIGH/MEDIUM/LOW** with the factor breakdown — Phase 11's transparent policy gate. *"This number isn't a black box — every contributing factor and its weight is shown."*
- The explanation paragraph above it — Gemini narrating the numbers it was given, not generating them.

### 4. Supervisor decision (30s)

Point at **Approve / Reject**, and the **Override** control offering the runner-up equipment candidates. *"Human-in-the-loop is not optional here — every recommendation, even a HIGH-confidence one, waits for this."* Click **Approve**.

### 5. Dispatch (15s)

Click **Dispatch to Worker**. *"This assigns an available simulated worker and moves the task to DISPATCHED — this is the report's 'simulated dispatch' step."*

### 6. Switch to the Worker App (45s)

In the second tab, pick the worker that was just assigned (their status will show `BUSY` — refresh the dropdown if needed, it re-polls every 5s). *"This is deliberately minimal — one active task, no clutter — matching the report's design principle for the mobile worker interface."* Click **Start Task**, then **Confirm Retrieval**.

### 7. Back to the dashboard (45s)

Task Tracking table now shows the task as `RETRIEVED`, with a **Mark Completed** button on that row (also available in the recommendation panel above, if it's still open for this task). Click it. *"Full lifecycle: Requested → Planned → Approved → Dispatched → In Progress → Retrieved → Completed — and every single transition, including the approval and the AI's original recommendation, is in an immutable audit log."* (Query `AuditEvent` via `npm run db:studio` live if you want to show the raw trail.)

## Optional detour: live adaptation (Simulation Controls)

This is the more impressive part if you have the extra 5 minutes — it demonstrates the system *reacting* to changing conditions, not just executing a static plan.

1. Click **Block Random Lane** — watch "Blocked lanes" tick up.
2. Submit a *new* retrieval request for a container in that area of the yard — the route it computes will visibly avoid the blocked lane (A* excludes blocked edges entirely).
3. Click **Simulate Congestion Spike** and **Flap Equipment Availability** — watch "Avg congestion" and "Equipment available" move.
4. Click **Start Background Simulation** — the yard now drifts continuously (equipment moves, congestion changes, occasional RFID events) without any manual triggering. *"This is the report's 'truck moves between nodes, congestion changes, equipment becomes unavailable' simulation requirement — running live."*
5. Click **Unblock All Lanes** / **Stop Background Simulation** to reset before continuing.

## If something breaks mid-demo

- **Gemini errors/rate-limits:** already handled automatically (see above) — just keep going.
- **State looks messy from earlier testing:** `npm run db:seed` resets to the pristine deterministic dataset (safe — it's local SQLite, gitignored).
- **A stuck "no equipment"/"no route" result:** that's the escalation path working as designed — narrate it as such rather than treating it as a bug. *"Not every request should auto-resolve — this is what escalation to a human looks like when the deterministic layer genuinely can't find a safe answer."*

## Talking points on what's simulated vs. real architecture

If asked "is this really talking to a TOS": no — `MockTOSAdapter` (`src/adapters/tos/`) stands in for a real Navis/Tideworks integration, behind the exact interface a real adapter would implement, so swapping it in later doesn't touch any calling code. Same pattern for IoT sensors (`SensorProvider`), Kafka (an in-process `EventBus`), and Redis (an in-memory cache warmed on lookup in `ContainerSearchService`). See `docs/PROTOTYPE_IMPLEMENTATION_PLAN.md`'s "Prototype vs. Report" table for the complete list and rationale.

If asked "why Gemini and not Claude" (the report specifies Claude): this was an explicit, disclosed deviation directed by the project owner mid-build — see the Phase 10 section of the implementation plan for the full record of that decision.
