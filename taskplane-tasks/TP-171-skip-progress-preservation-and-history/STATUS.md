# TP-171: Skip Progress Preservation and Batch History Gap — Status

**Current Step:** Step 1: Preserve Skipped Task Progress
**Status:** 🟡 In Progress
**Last Updated:** 2026-04-12
**Review Level:** 2
**Review Counter:** 2
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
**Status:** ✅ Done

- [x] Add skipped-lane task artifacts to mergeWave() artifact staging: include lanes with skipped tasks (but not in mergeableLanes) in the artifact staging loop so STATUS.md/reviews are copied to the merge worktree
- [x] Handle the edge case where mergeWorkDir may not exist (all tasks skipped, no mergeable lanes) — create a lightweight artifact-only commit on the orch branch
- [x] Verify safety-net auto-commit in engine.ts already captures skipped lane work (TP-147, line 3121-3123) — already confirmed present
- [x] Run targeted tests: tests/merge*.test.ts
- [x] R002-1: Fix workspace-mode filteredWaveResult to include skipped-lane outcomes so laneOutcomeByNumber works
- [x] R002-2: Fix stageSkippedArtifactsToTargetBranch to use isolated worktree instead of committing to repoRoot
- [x] R002-3: Fix mergeWaveByRepo early return to handle all-skipped case
- [x] R002: Re-run targeted tests

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
| 2026-04-12 15:54 | Review R001 | plan Step 1: APPROVE |
| 2026-04-12 15:59 | Review R002 | code Step 1: REVISE |
