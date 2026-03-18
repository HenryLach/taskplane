## Code Review: Step 1: Refactor Worktree Path Generation

### Verdict: REVISE

### Summary
The refactor correctly introduces batch-container helpers and updates `createWorktree()` to generate lane paths as `{basePath}/{opId}-{batchId}/lane-{N}` while preserving `worktree_location` base-path behavior. The new `generateMergeWorktreePath()` helper is also consistent with the lane-path base resolver. However, this step currently leaves runtime discovery/cleanup inconsistent with the new path layout, which causes immediate regressions in worktree lifecycle behavior.

### Issues Found
1. **[extensions/taskplane/worktree.ts:303,1161-1184] [important]** — `createWorktree()` now creates nested lane paths (`.../{opId}-{batchId}/lane-{N}`), but `listWorktrees()` still only matches flat basenames (`{prefix}-{opId}-{N}` / `{prefix}-{N}`). As a result, newly created worktrees are not discoverable for reuse/reset/cleanup flows (`ensureLaneWorktrees`, `removeAllWorktrees`, engine/resume callers). **Fix:** add transitional matching for the new nested pattern in `listWorktrees()` now (while retaining legacy matching), or avoid switching runtime path creation until list/cleanup support lands in the same checkpoint.
2. **[extensions/taskplane/worktree.ts:305-308] [minor]** — Container creation happens before validation pre-checks. If `baseBranch` is invalid (or another pre-check fails), an empty batch container may be left behind. **Fix:** move `ensureBatchContainerDir()` to just before `git worktree add` (after pre-checks), or clean up the container on early failure.

### Pattern Violations
- Behavior-affecting path migration was partially applied (creation changed, discovery unchanged), creating a temporary contract mismatch in core worktree lifecycle functions.

### Test Gaps
- No new/updated tests were included for nested container discovery yet.
- Validation run: `cd extensions && npx vitest run tests/worktree-lifecycle.test.ts tests/naming-collision.test.ts` shows 5 failing `worktree-lifecycle` cases, including `listWorktrees`/`removeAllWorktrees` failures consistent with the discovery mismatch.

### Suggestions
- Add focused unit coverage for `generateBatchContainerPath()` and `generateMergeWorktreePath()` in both `subdirectory` and `sibling` modes.
- Once callers are updated, consider making `batchId` required for `generateWorktreePath()` to avoid silent fallback to legacy flat naming.
