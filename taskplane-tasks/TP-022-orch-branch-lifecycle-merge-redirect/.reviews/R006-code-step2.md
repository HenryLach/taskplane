## Code Review: Step 2: Route Worktrees and Merge to Orch Branch

### Verdict: REVISE

### Summary
The Step 2 routing substitutions are mostly correct: `engine.ts` and `resume.ts` now pass `orchBranch` into wave execution/merge paths, and the inter-wave reset target was updated as intended. Tests are green (`cd extensions && npx vitest run` → 753 passed), but two behavioral issues remain: one leaves resume state inconsistent on a new guard return path, and one workspace fallback path can now resolve to a non-existent orch branch.

### Issues Found
1. **[extensions/taskplane/resume.ts:612-627] [critical]** — The new missing-`orchBranch` guard returns after setting `batchState.phase = "executing"` and `batchState.batchId`. That leaves in-memory runtime state appearing active even though resume aborted. This conflicts with the `/orch-resume` phase gate in `extensions/taskplane/extension.ts:378-384`, which can block follow-up resume attempts as if a batch were still running. **Fix:** run the guard before mutating runtime state, or set a safe terminal/idle phase (`failed` or `idle`), set `endedAt`, and record an error before returning.

2. **[extensions/taskplane/engine.ts:267-276, extensions/taskplane/resume.ts:1073-1083, extensions/taskplane/waves.ts:564-593, extensions/taskplane/worktree.ts:339-349] [important]** — `executeWave(..., batchState.orchBranch, ...)` now feeds `orchBranch` into `resolveBaseBranch(..., batchBaseBranch, ...)`. In workspace mode, if per-repo branch detection fails (detached HEAD) and no `defaultBranch` exists, fallback returns `batchBaseBranch` (now `orch/...`). That branch is only created in the primary repo, so worktree creation in another repo can fail with `WORKTREE_INVALID_BASE`. **Fix:** define explicit workspace fallback behavior for this case (e.g., require per-repo `defaultBranch`, fail fast with targeted guidance, or ensure orch branch exists per repo before using it as fallback).

### Pattern Violations
- None blocking beyond the two behavioral issues above.

### Test Gaps
- No behavioral test exercises resume with missing/empty `orchBranch` and asserts resulting `batchState.phase` is not left as `executing`.
- No workspace-mode test covers `resolveBaseBranch()` fallback when `repoId` is set and branch detection/default-branch resolution both fail after routing to orch branch.

### Suggestions
- Add one focused test for the missing-`orchBranch` resume guard that validates both user notification and runtime state mutation.
- Add one workspace lane-allocation test to lock in intended fallback behavior when a repo is detached or has no resolvable branch.
