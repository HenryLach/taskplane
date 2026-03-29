# TP-094: Context Pressure and Telemetry Accuracy Fix — Status

**Current Step:** Step 1: Fix field name mismatch
**Status:** 🟡 In Progress
**Last Updated:** 2026-03-29
**Review Level:** 2
**Review Counter:** 2
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
**Status:** 🟨 In Progress

**Normalized contract:** `SidecarTelemetryDelta.contextUsage` keeps internal field name `percent` (matching pi's authoritative name). All consumers updated.

**Substeps:**
- [ ] 1a. Type definition: rename `percentUsed` → `percent` in `SidecarTelemetryDelta.contextUsage` type (`task-runner.ts:1374`)
- [ ] 1b. Parser fix: in `tailSidecarJsonl()` response branch, read `cu.percent ?? cu.percentUsed` for backward compat (`task-runner.ts:1509-1512`)
- [ ] 1c. Worker consumer: update `delta.contextUsage.percentUsed` → `delta.contextUsage.percent` in worker `onTelemetry` callback (`task-runner.ts:3302`)
- [ ] 1d. Reviewer consumers: update `delta.contextUsage.percentUsed` → `delta.contextUsage.percent` in both reviewer telemetry paths (`task-runner.ts:2466`, `task-runner.ts:2673`)
- [ ] 1e. Remove manual token fallback globally — worker path (`task-runner.ts:3303-3305`), reviewer path 1 (`task-runner.ts:2467-2469`), reviewer path 2 (`task-runner.ts:2674-2676`). When authoritative metric unavailable, leave context % at 0 (no false thresholds).
- [ ] 1f. Add one-shot warning: log once per worker session when first telemetry cycle has no `contextUsage` (track via boolean flag `warnedNoContextUsage`). Log: `[task-runner] warning: pi did not provide contextUsage — context pressure thresholds disabled`
- [ ] 1g. Verify rpc-wrapper passes through correctly (read-only — no changes needed)

**Note:** Test fixtures still use `percentUsed` — will be updated in Step 3.

---

### Step 2: Context % snapshots at iteration boundaries
**Status:** ⬜ Not Started

- [ ] Write JSONL snapshot at worker iteration end
- [ ] Add to batch artifact cleanup

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

---

## Blockers

*None*

---

## Notes

*Reserved for execution notes*
