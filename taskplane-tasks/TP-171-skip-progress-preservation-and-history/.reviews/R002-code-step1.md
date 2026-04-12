## Code Review: Step 1: Preserve Skipped Task Progress

### Verdict: REVISE

### Summary
The change correctly targets the core repo-mode gap by extending artifact staging to include skipped lanes when at least one lane is mergeable. However, the workspace-mode wiring is incomplete, so skipped-lane artifacts are still excluded there. The new all-skipped fallback also commits directly in `repoRoot` without ensuring `targetBranch` is checked out, which can write to the wrong branch and violate the existing isolated-merge model.

### Issues Found
1. **[extensions/taskplane/merge.ts:2513-2529] [important]** In workspace mode, `mergeWaveByRepo()` now passes `allGroupLanes` to `mergeWave()`, but `filteredWaveResult` still contains only mergeable lanes. Inside `mergeWave()`, skipped-artifact detection depends on `laneOutcomeByNumber` built from `waveResult.laneResults`, so non-mergeable skipped lanes have no outcome and are dropped. **Fix:** include lane outcomes for all lanes in that repo group (not just mergeable) when building the repo-scoped `WaveExecutionResult`, or adjust `mergeWave()` to receive a complete outcome map.
2. **[extensions/taskplane/merge.ts:406-472] [critical]** `stageSkippedArtifactsToTargetBranch()` copies files into `repoRoot` and runs `git add/commit` there, but never checks out or verifies `targetBranch` (the parameter is unused). This can commit artifacts onto whatever branch is currently checked out and can also fail on dirty trees, contradicting the surrounding merge-worktree isolation model. **Fix:** perform artifact staging in a temporary worktree rooted at `targetBranch` (or temp branch + `update-ref`), then clean up, consistent with normal merge flow.
3. **[extensions/taskplane/merge.ts:2439-2448, 1403-1416] [important]** The “all tasks skipped / no mergeable lanes” path is not actually integrated for repo/workspace orchestrator entrypoints because `mergeWaveByRepo()` returns early when `mergeableLanes.length === 0`, so `mergeWave()` (and its new fallback) is never called. **Fix:** add a no-mergeable artifact-preservation path in `mergeWaveByRepo()` (or remove early return and delegate to `mergeWave()` with full lane outcomes) if this edge case is required.

### Pattern Violations
- None beyond the branch-isolation violation above.

### Test Gaps
- Missing regression test for **workspace mode**: repo group with at least one mergeable lane plus one skipped-only lane, asserting skipped task `STATUS.md`/`.reviews` are preserved after merge.
- Missing regression test for the **no-mergeable-lanes** edge path (if supported), including assertion that artifacts are committed to the orch target branch, not the currently checked-out branch.

### Suggestions
- Reuse the existing artifact allowlist/staging helper logic for both normal and fallback paths to reduce drift and security-surface divergence.
