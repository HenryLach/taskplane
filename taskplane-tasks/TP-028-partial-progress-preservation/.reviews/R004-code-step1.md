## Code Review: Step 1: Detect and Save Partial Progress

### Verdict: REVISE

### Summary
The step adds the right primitives (`savePartialProgress`, branch-name computation, collision handling) and wires preservation into the key orchestration phases in both fresh and resume flows. However, the current failure-path behavior is not safe enough: destructive reset/cleanup can still proceed when preservation fails, which can still lose partial commits. I also validated the suite (`cd extensions && npx vitest run`): all tests pass, but no new tests cover these new failure paths.

### Issues Found
1. **[extensions/taskplane/engine.ts:528-549, extensions/taskplane/engine.ts:554-567, extensions/taskplane/resume.ts:1335-1356, extensions/taskplane/resume.ts:1359-1386, extensions/taskplane/worktree.ts:2070-2077, extensions/taskplane/worktree.ts:2113-2119]** [critical] — Preservation failures are ignored before destructive branch-reset/removal.
   - `savePartialProgress()` explicitly returns `saved: false` + `error` on count/create failures, but call sites only log success and then continue into `safeResetWorktree()` / cleanup.
   - In inter-wave flows, this can still wipe lane-branch refs after a failed preservation attempt (the exact data-loss path TP-028 is intended to prevent).
   - **Fix:** enforce a failure policy: if preservation returns an error for a failed/stalled task, do not reset/remove that lane branch in this cycle (or stop cleanup and preserve worktrees for manual recovery), and emit explicit warning/error logs.

2. **[extensions/taskplane/worktree.ts:2145-2146, extensions/taskplane/worktree.ts:2247-2249, extensions/taskplane/engine.ts:782, extensions/taskplane/resume.ts:1461, extensions/taskplane/worktree.ts:822-825]** [important] — Contract mismatch: preserved-branch set is returned but not enforced by cleanup.
   - `preserveFailedLaneProgress()` returns `preservedBranches` with comments saying these should not be deleted, but neither `engine.ts` nor `resume.ts` passes any skip/exemption into cleanup.
   - Cleanup continues through `removeAllWorktrees()` → `ensureBranchDeleted()` which deletes source lane branches after preservation.
   - **Fix:** either wire `preservedBranches` into cleanup deletion decisions, or explicitly change the function contract/comments to reflect that only `saved/...` refs are retained and lane branches are intentionally deleted.

### Pattern Violations
- Recoverability policy is incomplete for the new feature: error results are produced by helpers but not acted on before destructive operations.

### Test Gaps
- No tests for preservation failure paths (`rev-list`/target missing/branch-create failure) and inter-wave safety behavior.
- No test validating cleanup behavior relative to `preservedBranches` contract.

### Suggestions
- Add targeted tests (new `extensions/tests/partial-progress.test.ts`) for: success path, collision idempotency, git failure behavior, and inter-wave no-reset-on-save-failure policy.
- Log per-task preservation failures (`taskId`, `laneBranch`, `repoId`, `error`) to improve operator recovery.
