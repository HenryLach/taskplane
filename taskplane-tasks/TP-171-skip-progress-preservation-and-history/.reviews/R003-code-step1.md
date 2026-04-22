## Code Review: Step 1: Preserve Skipped Task Progress

### Verdict: REVISE

### Summary
This revision addresses the two major issues from R002: skipped-artifact staging now uses an isolated temp worktree, and repo-group filtering now carries full lane outcomes for mixed repo groups. However, one workspace-mode gap remains: repos that have only skipped lanes are still ignored whenever any other repo has mergeable lanes. In that mixed multi-repo case, skipped task progress is still dropped for those skipped-only repos.

### Issues Found
1. **[extensions/taskplane/merge.ts:2499-2501, 2546-2577] [important]** `mergeWaveByRepo()` builds `repoGroups` from `mergeableLanes` only. If workspace wave has repo A with mergeable lanes and repo B with only skipped lanes, repo B is excluded from the loop entirely, so `stageSkippedArtifactsToTargetBranch()` is never invoked for repo B. This misses Step 1's outcome for skipped-task progress preservation in mixed multi-repo waves. **Fix:** include skipped-only repos in processing when mergeable lanes exist (e.g., build an additional skipped-only repo set not present in `repoGroups` and stage artifacts for them, or build groups from all completed repos and let per-repo `mergeWave()` no-mergeable fallback handle staging).

### Pattern Violations
- None.

### Test Gaps
- Missing regression test for workspace mode with **multiple repos** where one repo has mergeable lanes and another has skipped-only lanes; assert skipped repo `STATUS.md`/`.reviews` are preserved on the orch branch.

### Suggestions
- Consider centralizing skipped-artifact repo selection into a helper shared by both `mergeWave()` and `mergeWaveByRepo()` to avoid future divergence between repo-mode and workspace-mode paths.
