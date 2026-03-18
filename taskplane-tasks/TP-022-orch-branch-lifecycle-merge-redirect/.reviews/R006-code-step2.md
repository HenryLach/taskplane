## Code Review: Step 2: Route Worktrees and Merge to Orch Branch

### Verdict: REVISE

### Summary
The core routing substitutions in `engine.ts` and `resume.ts` are in place, and the new guard in resume correctly detects legacy persisted states with missing `orchBranch`. However, one new early-return path leaves in-memory runtime state inconsistent, and workspace-mode branch fallback is now riskier because `orchBranch` is passed through as the batch fallback branch. These need to be addressed before this step is safe to ship.

### Issues Found
1. **[extensions/taskplane/resume.ts:612-627] [critical]** — The new `orchBranch` guard returns after setting `batchState.phase = "executing"` and `batchState.batchId`, but without restoring/terminalizing state. This leaves the orchestrator thinking a batch is active even though resume aborted; `/orch-resume` then blocks future attempts due to the phase gate in `extensions/taskplane/extension.ts:378-384`. **Fix:** move the missing-`orchBranch` guard before mutating runtime state, or explicitly set a terminal/idle phase + endedAt/error before returning.

2. **[extensions/taskplane/engine.ts:267-276, extensions/taskplane/resume.ts:1073-1083, extensions/taskplane/waves.ts:564-593, extensions/taskplane/worktree.ts:339-349] [important]** — After this step, `executeWave(..., batchState.orchBranch, ...)` feeds `orchBranch` into `resolveBaseBranch()` fallback (`return batchBaseBranch`). In workspace mode, if `getCurrentBranch(repoRoot)` fails (detached HEAD) and no `defaultBranch` is configured, fallback now becomes `orch/<op>-<batch>` which does not exist in non-primary repos, causing worktree creation failure (`WORKTREE_INVALID_BASE`). This was called out as a Step 2 risk but remains unmitigated. **Fix:** define explicit fallback behavior for workspace repos (e.g., require per-repo `defaultBranch`, fail fast with targeted message, or ensure orch branch exists per repo before use).

### Pattern Violations
- None blocking.

### Test Gaps
- No behavioral test covers the new legacy-state guard path where `persistedState.orchBranch` is empty and verifies runtime state remains resumable/consistent after the rejection.
- No workspace-mode test covers detached/missing-branch detection fallback when `batchBaseBranch` is now an orch branch.

### Suggestions
- Add a small unit/integration test around `resumeOrchBatch()` with a mocked persisted state missing `orchBranch` to lock in expected phase/error behavior.
- Add a workspace-mode allocation test that exercises `resolveBaseBranch()` fallback with `repoId` + detached HEAD to prevent regressions in branch routing semantics.
