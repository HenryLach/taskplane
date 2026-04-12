# TP-171: Skip Progress Preservation and Batch History Gap — Status

**Current Step:** Step 0: Preflight and Analysis
**Status:** 🟡 In Progress
**Last Updated:** 2026-04-12
**Review Level:** 2
**Review Counter:** 0
**Iteration:** 1
**Size:** L

---

### Step 0: Preflight and Analysis
**Status:** ✅ Done

- [x] Read merge.ts — succeeded-only lane filter
- [x] Read engine.ts — skip propagation to lane state
- [x] Read persistence.ts — batch history population (`saveBatchHistory`)
- [x] Identify skipped-lane merge exclusion path
- [x] Identify batch history task gap root cause
- [x] Document findings

---

### Step 1: Preserve Skipped Task Progress
**Status:** ⬜ Not Started

> ⚠️ Hydrate: Expand based on analysis in Step 0

- [ ] Preserve STATUS.md and worker commits for skipped tasks
- [ ] Ensure skipped STATUS.md reflects actual progress
- [ ] Run targeted tests

---

### Step 2: Fix Batch History Task Gap
**Status:** ⬜ Not Started

> ⚠️ Hydrate: Expand based on analysis in Step 0

- [ ] All wave-planned tasks recorded in history
- [ ] Include skipped/failed/never-started tasks
- [ ] Run targeted tests

---

### Step 3: Testing & Verification
**Status:** ⬜ Not Started

- [ ] FULL test suite passing
- [ ] Regression test: skipped task progress preserved
- [ ] Regression test: all tasks in batch history
- [ ] All failures fixed

---

### Step 4: Documentation & Delivery
**Status:** ⬜ Not Started

- [ ] Discoveries logged

---

## Reviews

| # | Type | Step | Verdict | File |
|---|------|------|---------|------|

---

## Discoveries

| Discovery | Disposition | Location |
|-----------|-------------|----------|
| **#453 root cause:** `mergeWave()` artifact staging (merge.ts:1944) only iterates `orderedLanes` (mergeable lanes with >=1 succeeded task). Skipped-only lanes are excluded from `mergeableLanes` filter, so their STATUS.md is never staged into the merge worktree. `preserveSkippedLaneProgress()` saves the branch but doesn't integrate artifacts into the orch branch. | Fix in Step 1 | merge.ts:1299-1329, 1944 |
| **#455 root cause:** TP-147 already added gap-filling code (engine.ts:4055-4074) that adds tasks from `wavePlan` not in `allTaskOutcomes`. However, tasks that are skipped MID-wave (e.g., by stop-wave policy when a sibling fails) may be added to `allTaskOutcomes` with status "skipped" but their task ID might not match the wave plan due to dynamic segment expansion or be missing from `wavePlan` altogether. Also, when tasks were blocked by upstream failure, they were added as blocked but if `blockedTaskIds` set was stale, they could be missed. Need to verify the gap-filling is exhaustive and handles all edge cases. | Verify in Step 2 | engine.ts:4055-4074 |

---

## Execution Log

| Timestamp | Action | Outcome |
|-----------|--------|---------|
| 2026-04-12 | Task staged | PROMPT.md and STATUS.md created |
| 2026-04-12 15:49 | Task started | Runtime V2 lane-runner execution |
| 2026-04-12 15:49 | Step 0 started | Preflight and Analysis |

---

## Blockers

*None*

---

## Notes

GitHub issues: #453, #455
