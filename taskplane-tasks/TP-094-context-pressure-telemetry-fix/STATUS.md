# TP-094: Context Pressure and Telemetry Accuracy Fix — Status

**Current Step:** Step 3: Testing & Verification
**Status:** 🟡 In Progress
**Last Updated:** 2026-03-29
**Review Level:** 2
**Review Counter:** 5
**Iteration:** 4
**Size:** M

---

### Step 0: Preflight
**Status:** ✅ Complete

- [x] Verify field name mismatch in real sidecar data
- [x] Trace all percentUsed code paths
- [x] Identify manual fallback removal points

---

### Step 1: Fix field name mismatch in sidecar tailing
**Status:** ✅ Complete

- [x] 1a. Type: renamed `percentUsed` → `percent` in `SidecarTelemetryDelta.contextUsage`
- [x] 1b. Parser: reads `cu.percent ?? cu.percentUsed` for backward compat
- [x] 1c. Worker consumer: updated to `.percent`
- [x] 1d. Reviewer consumers (both paths): updated to `.percent`
- [x] 1e. Manual token fallback removed from worker + both reviewer paths
- [x] 1f. One-shot warning: gated on `sawStatsResponseWithoutContextUsage` flag (not hadEvents)
- [x] 1g. rpc-wrapper verified: passes through correctly, no changes needed

---

### Step 2: Context % snapshots at iteration boundaries
**Status:** ✅ Complete

- [x] Write JSONL snapshot at worker iteration end (`writeContextSnapshot()` after `runWorker()`)
- [x] Add to batch artifact cleanup (post-integrate + preflight age sweep)

---

### Step 3: Testing & Verification
**Status:** ⬜ Not Started

- [ ] Tests for correct field extraction
- [ ] Full test suite passing

---

### Step 4: Documentation & Delivery
**Status:** ⬜ Not Started

- [ ] Log discoveries

---

## Reviews

| # | Type | Step | Verdict | File |
| R001 | plan | Step 1 | REVISE | .reviews/R001-plan-step1.md |
| R002 | plan | Step 1 | APPROVE | .reviews/R002-plan-step1.md |
| R003 | code | Step 1 | REVISE | .reviews/R003-code-step1.md |
| R004 | code | Step 1 | APPROVE | .reviews/R004-code-step1.md |
| R005 | plan | Step 3 | UNKNOWN | .reviews/R005-plan-step3.md |
|---|------|------|---------|------|

---

## Discoveries

| Discovery | Disposition | Location |
|-----------|-------------|----------|
| Pi sends `contextUsage.percent` but code checks `cu.percentUsed` — always undefined | Fix in Step 1 | `extensions/task-runner.ts:1509` |
| 6 locations reference `.percentUsed` in task-runner.ts: L1374 (type), L1509-1511 (sidecar parse), L2466, L2673 (reviewer), L3302 (worker onTelemetry) | Fix all in Step 1 | `extensions/task-runner.ts` |
| Manual fallback `(delta.latestTotalTokens / contextWindow) * 100` at L3303-3305 and L2468-2469, L2675-2676 (reviewer) | Remove in Step 1 | `extensions/task-runner.ts` |
| rpc-wrapper passes through `event.data.contextUsage` unmodified — field name is `percent` from pi, correct passthrough | No change needed | `bin/rpc-wrapper.mjs:426` |
| Tests in sidecar-tailing.test.ts use `percentUsed` in test data (wrong field) | Fix in Step 3 | `extensions/tests/sidecar-tailing.test.ts` |

---

## Execution Log

| Timestamp | Action | Outcome |
|-----------|--------|---------|
| 2026-03-29 | Task staged | PROMPT.md and STATUS.md created |
| 2026-03-29 14:58 | Task started | Extension-driven execution |
| 2026-03-29 14:58 | Step 0 started | Preflight |
| 2026-03-29 14:58 | Task started | Extension-driven execution |
| 2026-03-29 14:58 | Step 0 started | Preflight |
| 2026-03-29 14:58 | Worker iter 1 | done in 3s, ctx: 0%, tools: 0 |
| 2026-03-29 14:58 | No progress | Iteration 1: 0 new checkboxes (1/3 stall limit) |
| 2026-03-29 14:58 | Worker iter 2 | done in 3s, ctx: 0%, tools: 0 |
| 2026-03-29 14:58 | No progress | Iteration 1: 0 new checkboxes (1/3 stall limit) |
| 2026-03-29 14:58 | Worker iter 2 | done in 3s, ctx: 0%, tools: 0 |
| 2026-03-29 14:58 | No progress | Iteration 2: 0 new checkboxes (2/3 stall limit) |
| 2026-03-29 14:58 | Worker iter 3 | done in 3s, ctx: 0%, tools: 0 |
| 2026-03-29 14:58 | No progress | Iteration 2: 0 new checkboxes (2/3 stall limit) |
| 2026-03-29 14:58 | Worker iter 3 | done in 3s, ctx: 0%, tools: 0 |
| 2026-03-29 14:58 | No progress | Iteration 3: 0 new checkboxes (3/3 stall limit) |
| 2026-03-29 14:58 | Task blocked | No progress after 3 iterations |
| 2026-03-29 14:58 | Worker iter 4 | done in 2s, ctx: 0%, tools: 0 |
| 2026-03-29 14:58 | No progress | Iteration 3: 0 new checkboxes (3/3 stall limit) |
| 2026-03-29 14:58 | Task blocked | No progress after 3 iterations |
| 2026-03-29 | Step 0 complete | Confirmed: pi sends `percent`, code checks `percentUsed` — 6 locations to fix, manual fallback in 3 locations |
| 2026-03-29 15:00 | Reviewer R001 | persistent reviewer failed — falling back to fresh spawn: Persistent reviewer exited within 30s of spawn without producing a verdict — wait_for_review tool may not be supported by this model (e.g., called via bash instead of as a registered tool) |
| 2026-03-29 15:03 | Review R001 | plan Step 1: REVISE (fallback) |
| 2026-03-29 15:05 | Reviewer R002 | persistent reviewer failed — falling back to fresh spawn: Persistent reviewer session died while waiting for verdict |
| 2026-03-29 15:08 | Review R002 | plan Step 1: APPROVE (fallback) |
| 2026-03-29 15:09 | Reviewer R003 | persistent reviewer failed — falling back to fresh spawn: Persistent reviewer exited within 30s of spawn without producing a verdict — wait_for_review tool may not be supported by this model (e.g., called via bash instead of as a registered tool) |
| 2026-03-29 15:12 | Review R003 | code Step 1: REVISE (fallback) |
| 2026-03-29 15:13 | Reviewer R004 | persistent reviewer failed — falling back to fresh spawn: Persistent reviewer exited within 30s of spawn without producing a verdict — wait_for_review tool may not be supported by this model (e.g., called via bash instead of as a registered tool) |
| 2026-03-29 15:16 | Review R004 | code Step 1: APPROVE (fallback) |
| 2026-03-29 15:18 | Reviewer R005 | persistent reviewer failed — falling back to fresh spawn: Persistent reviewer exited within 30s of spawn without producing a verdict — wait_for_review tool may not be supported by this model (e.g., called via bash instead of as a registered tool) |
| 2026-03-29 15:26 | Review R005 | plan Step 3: UNKNOWN (fallback) |

---

## Blockers

*None*

---

## Notes

*Reserved for execution notes*
