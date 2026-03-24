# TP-050: Worker-Driven Inline Reviews — Status

**Current Step:** Not Started
**Status:** 🔵 Ready for Execution
**Last Updated:** 2026-03-24
**Review Level:** 2
**Review Counter:** 0
**Iteration:** 0
**Size:** L

> **Hydration:** Checkboxes represent meaningful outcomes, not individual code
> changes. Workers expand steps when runtime discoveries warrant it.

---

### Step 0: Preflight
**Status:** ⬜ Not Started

- [ ] Understand current step loop and deferred review mechanism
- [ ] Understand doReview() and reviewer spawn infrastructure
- [ ] Understand spawnAgentTmux() and onTelemetry callback pattern
- [ ] Understand lane-state sidecar structure and reviewer fields
- [ ] Understand dashboard lane rendering
- [ ] Understand pi extension tool registration API

---

### Step 1: Register review_step extension tool
**Status:** ⬜ Not Started

> ⚠️ Hydrate: Expand based on pi tool registration API discovered in Step 0

- [ ] Register review_step tool (orchestrated mode only)
- [ ] Tool handler: generate review request, spawn reviewer via spawnAgentTmux
- [ ] Tool handler: update lane-state sidecar with reviewer metrics via onTelemetry
- [ ] Tool handler: extract verdict from review output, return to worker
- [ ] Tool handler: log review in STATUS.md

---

### Step 2: Remove deferred review logic from step loop
**Status:** ⬜ Not Started

- [ ] Remove post-worker-exit deferred review block
- [ ] Remove REVISE → mark-incomplete-for-rework logic
- [ ] Preserve iteration mechanism and low-risk skip safety net

---

### Step 3: Update worker agent template with review protocol
**Status:** ⬜ Not Started

- [ ] Add review protocol section to task-worker.md
- [ ] Add review protocol section to local/task-worker.md
- [ ] Include review level interpretation and skip rules
- [ ] Include verdict handling instructions

---

### Step 4: Update lane-state sidecar with reviewer metrics
**Status:** ⬜ Not Started

- [ ] Extend writeLaneState() with reviewer telemetry fields
- [ ] reviewerSessionName, reviewerType, reviewerStep exposed
- [ ] reviewerElapsed, reviewerContextPct, reviewerLastTool, reviewerToolCount
- [ ] reviewerCostUsd, reviewerInputTokens, reviewerOutputTokens
- [ ] Fields zeroed when reviewer idle

---

### Step 5: Dashboard reviewer sub-row
**Status:** ⬜ Not Started

- [ ] Server passes reviewer fields through to client
- [ ] Client renders reviewer sub-row when reviewerStatus === "running"
- [ ] Worker row shows [awaiting review] during review
- [ ] Reviewer sub-row shows elapsed, tools, last tool, cost, context%
- [ ] Reviewer row disappears when review completes
- [ ] Reviewer cost included in lane total

---

### Step 6: Testing & Verification
**Status:** ⬜ Not Started

- [ ] All existing tests pass
- [ ] Tests for review_step tool registration (orchestrated mode only)
- [ ] Tests for review_step handler (request generation, spawn, verdict)
- [ ] Tests for lane-state sidecar reviewer metrics
- [ ] Tests for step loop no longer runs deferred reviews
- [ ] Tests for worker template review protocol

---

### Step 7: Documentation & Delivery
**Status:** ⬜ Not Started

- [ ] Check affected docs (execution-model.md, review-loop.md)
- [ ] Discoveries logged
- [ ] `.DONE` created

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

---

## Blockers

*None*

---

## Notes

*Reserved for execution notes*
