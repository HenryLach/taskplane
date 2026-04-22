# TP-171: Skip Progress Preservation and Batch History Gap — Status

**Current Step:** Step 4: Documentation & Delivery
**Status:** ✅ Complete
**Last Updated:** 2026-04-12
**Review Level:** 2
**Review Counter:** 6
**Iteration:** 1
**Size:** L

---

### Step 0: Preflight and Analysis
**Status:** ✅ Complete

- [x] Read merge.ts — succeeded-only lane filter
- [x] Read engine.ts — skip propagation to lane state
- [x] Read persistence.ts — batch history population (`saveBatchHistory`)
- [x] Identify skipped-lane merge exclusion path
- [x] Identify batch history task gap root cause
- [x] Document findings

---

### Step 1: Preserve Skipped Task Progress
**Status:** ✅ Complete

- [x] Add skipped-lane task artifacts to mergeWave() artifact staging: include lanes with skipped tasks (but not in mergeableLanes) in the artifact staging loop so STATUS.md/reviews are copied to the merge worktree
- [x] Handle the edge case where mergeWorkDir may not exist (all tasks skipped, no mergeable lanes) — create a lightweight artifact-only commit on the orch branch
- [x] Verify safety-net auto-commit in engine.ts already captures skipped lane work (TP-147, line 3121-3123) — already confirmed present
- [x] Run targeted tests: tests/merge*.test.ts
- [x] R002-1: Fix workspace-mode filteredWaveResult to include skipped-lane outcomes so laneOutcomeByNumber works
- [x] R002-2: Fix stageSkippedArtifactsToTargetBranch to use isolated worktree instead of committing to repoRoot
- [x] R002-3: Fix mergeWaveByRepo early return to handle all-skipped case
- [x] R002: Re-run targeted tests
- [x] R003-1: Fix workspace-mode multi-repo gap — skipped-only repos bypassed when other repos have mergeable lanes
- [x] R003: Re-run targeted tests
- [x] R004-1: Remove .DONE from skipped-artifact staging allowlist (only STATUS.md, REVIEW_VERDICT.json, .reviews)
- [x] R004-2: Gate post-loop skipped-only staging behind !anyRollbackFailed in mergeWaveByRepo
- [x] R004: Re-run targeted tests

---

### Step 2: Fix Batch History Task Gap
**Status:** ✅ Complete

- [x] Verify TP-147 gap-filling logic in engine.ts covers all cases (skipped, failed, blocked, never-started)
- [x] Check if dynamically expanded tasks (segment expansion) are included in wavePlan — confirmed: segment expansion uses same task IDs, only adds continuation rounds to runtimeSegmentRounds (not wavePlan); task IDs are already in wavePlan from original wave computation
- [x] Add edge-case handling: fixed invalid status cast ("running" → "pending") for tasks in non-terminal state at batch end; tasks in allTaskOutcomes but not wavePlan get wave=0 (correct); TP-147 gap-fill covers reverse case
- [x] Run targeted tests: tests/batch-history-persistence.test.ts

---

### Step 3: Testing & Verification
**Status:** ✅ Complete

- [x] FULL test suite passing (3290/3290 pass)
- [x] Regression test: skipped task progress preserved (13 tests in skip-progress-preservation.test.ts)
- [x] Regression test: all tasks in batch history (included in skip-progress-preservation.test.ts)
- [x] All failures fixed

---

### Step 4: Documentation & Delivery
**Status:** ✅ Complete

- [x] Discoveries logged

---

## Reviews

| # | Type | Step | Verdict | File |
|---|------|------|---------|------|

---

## Discoveries

| Discovery | Disposition | Location |
|-----------|-------------|----------|
| **#453 root cause:** `mergeWave()` artifact staging (merge.ts:1944) only iterates `orderedLanes` (mergeable lanes with >=1 succeeded task). Skipped-only lanes are excluded from `mergeableLanes` filter, so their STATUS.md is never staged into the merge worktree. `preserveSkippedLaneProgress()` saves the branch but doesn't integrate artifacts into the orch branch. | Fix in Step 1 | merge.ts:1299-1329, 1944 |
| **#455 root cause:** TP-147 gap-filling code is correct for the main case (blocked, pending, never-started tasks). Remaining gap was invalid status cast: `to.status as BatchTaskSummary["status"]` could produce "running" (not a valid BatchTaskSummary status) when batch pauses mid-wave. Fixed by adding explicit status validation mapping. Segment expansion doesn't add NEW task IDs, only new segments for existing tasks. | Fixed in Step 2 | engine.ts:4030-4040 |
| **stageSkippedArtifactsToTargetBranch must use isolated worktree** — initial implementation committed artifacts directly to repoRoot without verifying the target branch, violating the merge isolation model. Fixed to use a temp worktree. | Fixed in Step 1 R002 | merge.ts:406-505 |
| **Skipped-artifact allowlist must exclude .DONE** — staging .DONE for tasks whose code was not merged creates false completion markers on the orch branch. Split allowlists: merged lanes get full set (.DONE, STATUS.md, etc), skipped lanes get restricted set (STATUS.md, REVIEW_VERDICT.json, .reviews). | Fixed in Step 1 R004 | merge.ts:2094-2098 |

---

## Execution Log

| Timestamp | Action | Outcome |
|-----------|--------|---------|
| 2026-04-12 | Task staged | PROMPT.md and STATUS.md created |
| 2026-04-12 15:49 | Task started | Runtime V2 lane-runner execution |
| 2026-04-12 15:49 | Step 0 started | Preflight and Analysis |
| 2026-04-12 16:24 | Worker iter 1 | done in 2069s, tools: 186 |
| 2026-04-12 16:24 | Task complete | .DONE created |

---

## Blockers

*None*

---

## Notes

GitHub issues: #453, #455
| 2026-04-12 15:54 | Review R001 | plan Step 1: APPROVE |
| 2026-04-12 15:59 | Review R002 | code Step 1: REVISE |
| 2026-04-12 16:03 | Review R003 | code Step 1: REVISE |
| 2026-04-12 16:08 | Review R004 | code Step 1: REVISE |
| 2026-04-12 16:11 | Review R005 | plan Step 2: APPROVE |
| 2026-04-12 16:17 | Review R006 | code Step 2: APPROVE |
