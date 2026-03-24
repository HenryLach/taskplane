# TP-050: Worker-Driven Inline Reviews — Status

**Current Step:** Complete
**Status:** ✅ Complete
**Last Updated:** 2026-03-24
**Review Level:** 2
**Review Counter:** 0
**Iteration:** 2
**Size:** L

> **Hydration:** Checkboxes represent meaningful outcomes, not individual code
> changes. Workers expand steps when runtime discoveries warrant it.

---

### Step 0: Preflight
**Status:** ✅ Complete

- [x] Understand current step loop and deferred review mechanism
- [x] Understand doReview() and reviewer spawn infrastructure
- [x] Understand spawnAgentTmux() and onTelemetry callback pattern
- [x] Understand lane-state sidecar structure and reviewer fields
- [x] Understand dashboard lane rendering
- [x] Understand pi extension tool registration API

---

### Step 1: Register review_step extension tool
**Status:** ✅ Complete

> ⚠️ Hydrate: Expanded based on pi tool registration API (pi.registerTool with Type.Object params, async execute returning AgentToolResult). Tool only registered in orchestrated mode (isOrchestratedMode()). Uses existing doReview()-like pattern: generateReviewRequest → spawnAgentTmux → extractVerdict → logReview.

- [x] Add Type import from @mariozechner/pi-ai and register review_step tool with pi.registerTool (gated on isOrchestratedMode())
- [x] Implement tool execute handler: generate review request, spawn reviewer via spawnAgentTmux, wire onTelemetry to update state, extract verdict, log review, return verdict string to worker
- [x] Add reviewer telemetry fields to TaskState (reviewerToolCount, reviewerInputTokens, etc.) for onTelemetry callback to populate

---

### Step 2: Remove deferred review logic from step loop
**Status:** ✅ Complete

- [x] Remove post-worker-exit deferred review block
- [x] Remove REVISE → mark-incomplete-for-rework logic
- [x] Preserve iteration mechanism and low-risk skip safety net

---

### Step 3: Update worker agent template with review protocol
**Status:** ✅ Complete

- [x] Add review protocol section to task-worker.md
- [x] Add review protocol section to local/task-worker.md
- [x] Include review level interpretation and skip rules
- [x] Include verdict handling instructions

---

### Step 4: Update lane-state sidecar with reviewer metrics
**Status:** ✅ Complete

- [x] Extend writeLaneState() with reviewer telemetry fields
- [x] reviewerSessionName, reviewerType, reviewerStep exposed
- [x] reviewerElapsed, reviewerContextPct, reviewerLastTool, reviewerToolCount
- [x] reviewerCostUsd, reviewerInputTokens, reviewerOutputTokens
- [x] Fields zeroed when reviewer idle

---

### Step 5: Dashboard reviewer sub-row
**Status:** ✅ Complete

- [x] Server passes reviewer fields through to client
- [x] Client renders reviewer sub-row when reviewerStatus === "running"
- [x] Worker row shows [awaiting review] during review
- [x] Reviewer sub-row shows elapsed, tools, last tool, cost, context%
- [x] Reviewer row disappears when review completes
- [x] Reviewer cost included in lane total

---

### Step 6: Testing & Verification
**Status:** ✅ Complete

- [x] All existing tests pass
- [x] Tests for review_step tool registration (orchestrated mode only)
- [x] Tests for review_step handler (request generation, spawn, verdict)
- [x] Tests for lane-state sidecar reviewer metrics
- [x] Tests for step loop no longer runs deferred reviews
- [x] Tests for worker template review protocol

---

### Step 7: Documentation & Delivery
**Status:** ✅ Complete

- [x] Check affected docs (execution-model.md, review-loop.md)
- [x] Discoveries logged
- [x] `.DONE` created

---

## Reviews

| # | Type | Step | Verdict | File |
|---|------|------|---------|------|

---

## Discoveries

| Discovery | Disposition | Location |
|-----------|-------------|----------|

---

## Execution Log

| Timestamp | Action | Outcome |
|-----------|--------|---------|
| 2026-03-24 | Task staged | PROMPT.md and STATUS.md created |
| 2026-03-24 04:23 | Task started | Extension-driven execution |
| 2026-03-24 04:23 | Step 0 started | Preflight |
| 2026-03-24 04:23 | Step 1 started | Register `review_step` extension tool |
| 2026-03-24 04:23 | Step 2 started | Remove deferred review logic from the step loop |
| 2026-03-24 04:23 | Step 3 started | Update worker agent template with review protocol |
| 2026-03-24 04:23 | Step 4 started | Update lane-state sidecar with reviewer metrics |
| 2026-03-24 04:23 | Step 5 started | Dashboard reviewer sub-row |
| 2026-03-24 04:23 | Step 6 started | Testing & Verification |
| 2026-03-24 04:23 | Step 7 started | Documentation & Delivery |
| 2026-03-24 04:23 | Task started | Extension-driven execution |
| 2026-03-24 04:23 | Step 0 started | Preflight |
| 2026-03-24 04:23 | Step 1 started | Register `review_step` extension tool |
| 2026-03-24 04:23 | Step 2 started | Remove deferred review logic from the step loop |
| 2026-03-24 04:23 | Step 3 started | Update worker agent template with review protocol |
| 2026-03-24 04:23 | Step 4 started | Update lane-state sidecar with reviewer metrics |
| 2026-03-24 04:23 | Step 5 started | Dashboard reviewer sub-row |
| 2026-03-24 04:23 | Step 6 started | Testing & Verification |
| 2026-03-24 04:23 | Step 7 started | Documentation & Delivery |

---

## Blockers

*None*

---

## Notes

*Reserved for execution notes*
