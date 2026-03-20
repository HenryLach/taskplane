# TP-027: Dashboard Real-Time Telemetry — Status

**Current Step:** Step 1: Dashboard Server — Serve Telemetry Data
**Status:** 🟡 In Progress
**Last Updated:** 2026-03-20
**Review Level:** 1
**Review Counter:** 1
**Iteration:** 1
**Size:** M

---

### Step 0: Preflight
**Status:** ✅ Complete

- [x] Read dashboard server data flow
- [x] Read dashboard frontend rendering
- [x] Read roadmap Phase 1 section 1d
- [x] Read Tier 2 context (CONTEXT.md) and capture constraints
- [x] Record preflight findings in Discoveries/Notes with file+line anchors and implementation guardrails

---

### Step 1: Dashboard Server — Serve Telemetry Data
**Status:** 🟨 In Progress

- [ ] Read sidecar JSONL files incrementally
- [ ] Accumulate per-lane telemetry
- [ ] Compute batch total cost
- [ ] Include telemetry in status API response
- [ ] Handle missing telemetry gracefully

---

### Step 2: Dashboard Frontend — Display Telemetry
**Status:** ⬜ Not Started

- [ ] Add telemetry display to lane view
- [ ] Add batch cost total to summary
- [ ] Retry and compaction indicators
- [ ] Style as secondary/compact
- [ ] Graceful degradation for pre-RPC lanes

---

### Step 3: Testing & Verification
**Status:** ⬜ Not Started

- [ ] Manual dashboard test with mock data
- [ ] No JS errors in console
- [ ] Full test suite passes
- [ ] Dashboard loads cleanly

---

### Step 4: Documentation & Delivery
**Status:** ⬜ Not Started

- [ ] Docs updated if needed
- [ ] `.DONE` created

---

## Reviews

| # | Type | Step | Verdict | File |
| R001 | plan | Step 0 | APPROVE | .reviews/R001-plan-step0.md |
| R001 | plan | Step 0 | REVISE | .reviews/R001-plan-step0.md |
|---|------|------|---------|------|

---

## Discoveries

| Discovery | Disposition | Location |
|-----------|-------------|----------|
| Dashboard already displays tokens/cost/context%/lastTool from lane-state-*.json sidecar files | Inform Step 1 — server already loads these; new work is reading telemetry JSONL for retries/compactions | dashboard/server.cjs `loadLaneStates()`, dashboard/public/app.js `tokenSummaryFromLaneState()` |
| Telemetry JSONL files from RPC wrapper (TP-025/026) at `.pi/telemetry/` are the NEW data source | Step 1 must read these incrementally and merge with existing lane state data | docs/specifications/taskplane/resilience-and-diagnostics-roadmap.md §1d |
| Server data flow: loadBatchState() → buildDashboardState() → SSE broadcast; loadLaneStates() reads .pi/lane-state-*.json | Step 1: add loadTelemetryData() alongside loadLaneStates() in buildDashboardState() | dashboard/server.cjs:73-78, 172-191, 197-215 |
| Frontend lane rendering: renderLanesTasks() shows worker-stats div with tokens/cost/context%/lastTool from laneStates | Step 2: extend worker-stats section; do NOT replace existing lane-state display — add telemetry overlay | dashboard/public/app.js:310-345 (worker-stats block) |
| Frontend batch cost: renderSummary() already aggregates lane-state tokens into batch total | Step 2: merge telemetry JSONL cost with lane-state cost; avoid double-counting | dashboard/public/app.js:240-260 (batch token aggregation) |
| Roadmap §1d target metrics: tokens, cost/lane, batch cost, context%, last tool, retries, compactions | Step 1/2: retries and compactions are NEW metrics not in lane-state; all others already exist from lane-state | resilience-and-diagnostics-roadmap.md §1d metrics table |
| CONTEXT.md has no constraints affecting dashboard work | No action needed | taskplane-tasks/CONTEXT.md |

---

## Execution Log

| Timestamp | Action | Outcome |
|-----------|--------|---------|
| 2026-03-19 | Task staged | PROMPT.md and STATUS.md created |
| 2026-03-20 02:36 | Task started | Extension-driven execution |
| 2026-03-20 02:36 | Step 0 started | Preflight |
| 2026-03-20 02:36 | Task started | Extension-driven execution |
| 2026-03-20 02:36 | Step 0 started | Preflight |
| 2026-03-20 02:37 | Review R001 | plan Step 0: APPROVE |
| 2026-03-20 02:38 | Review R001 | plan Step 0: REVISE |
| 2026-03-20 02:39 | Worker iter 1 | done in 98s, ctx: 26%, tools: 15 |
| 2026-03-20 02:39 | Step 0 complete | Preflight |
| 2026-03-20 02:39 | Step 1 started | Dashboard Server — Serve Telemetry Data |

---

## Blockers

*None*

---

## Notes

### Preflight Findings

**Data flow architecture (server):**
- server.cjs:73-78 — loadBatchState() reads .pi/batch-state.json
- server.cjs:172-191 — loadLaneStates() reads .pi/lane-state-*.json (existing telemetry source)
- server.cjs:197-215 — buildDashboardState() assembles batch + laneStates for frontend
- NEW: Need loadTelemetryData() to read .pi/telemetry/*.jsonl files incrementally

**Data flow architecture (frontend):**
- app.js:56-70 — tokenSummaryFromLaneState() formats existing token display
- app.js:240-260 — renderSummary() aggregates batch-wide tokens/cost from laneStates
- app.js:310-345 — renderLanesTasks() renders worker-stats div per lane
- NEW: Extend worker-stats with retry/compaction badges; merge telemetry JSONL data

**Implementation guardrails:**
1. DO NOT remove or replace existing lane-state telemetry display — it works and is the primary source
2. Telemetry JSONL provides ADDITIONAL metrics (retries, compactions) and may supplement cost data
3. Avoid double-counting cost: if both lane-state and JSONL report cost, prefer lane-state (authoritative)
4. Handle missing .pi/telemetry/ directory gracefully — pre-RPC sessions won't have it
5. Incremental file reading: track byte offset per JSONL file to avoid re-parsing on each poll
6. Keep dashboard zero-dependency — no new npm packages
