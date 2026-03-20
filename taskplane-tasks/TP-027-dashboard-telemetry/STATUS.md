# TP-027: Dashboard Real-Time Telemetry — Status

**Current Step:** Step 0: Preflight
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
- [ ] Read Tier 2 context (CONTEXT.md) and capture constraints
- [ ] Record preflight findings in Discoveries/Notes with file+line anchors and implementation guardrails

---

### Step 1: Dashboard Server — Serve Telemetry Data
**Status:** ⬜ Not Started

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

---

## Blockers

*None*

---

## Notes

*Reserved for execution notes*
