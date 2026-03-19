## Code Review: Step 1: Detect and Save Partial Progress

### Verdict: REVISE

### Summary
The new partial-progress helpers and call-site wiring are in the right places (inter-wave reset and terminal cleanup in both `engine.ts` and `resume.ts`), and the branch naming/collision handling is directionally solid. However, the current flow still allows destructive cleanup/reset to continue when partial-progress save fails, which can silently lose commits in the exact failure path this step is meant to protect. There is also a contract mismatch between the returned `preservedBranches` set and cleanup behavior.

### Issues Found
1. **[extensions/taskplane/engine.ts:528-567, extensions/taskplane/resume.ts:1335-1385, extensions/taskplane/worktree.ts:2050-2137] [important]** — Partial-progress save failures are ignored before destructive reset/cleanup. `savePartialProgress()` can return `saved: false` with an `error` for branch/count/create failures, but callers only log when `saved === true` and then proceed into `safeResetWorktree()` / cleanup. If preservation fails, branch reset can still wipe lane commits. **Fix:** treat any failed preservation with potential progress (`commitCount > 0` or explicit `error`) as a hard warning path: either (a) skip reset/removal for that lane branch, or (b) abort cleanup/reset for the batch and preserve worktrees for manual recovery. At minimum, emit explicit warning/error logs for failed save attempts.
2. **[extensions/taskplane/worktree.ts:2142-2146, extensions/taskplane/engine.ts:754-782, extensions/taskplane/resume.ts:1404-1429] [important]** — `preservedBranches` is returned but never consumed, so lane-branch deletion is not actually gated by preservation outcome. The helper contract/comments say these branches "should NOT be deleted during cleanup," but cleanup still runs with no exemption list. **Fix:** either wire `preservedBranches` into cleanup/branch-deletion decisions (e.g., `removeAllWorktrees`/`ensureBranchDeleted` skip list), or remove/rename this contract and explicitly document that only the new `saved/...` ref is retained while lane branches are still deleted.

### Pattern Violations
- No explicit failure-policy handling is implemented for partial-progress preservation errors, despite recoverability-focused cleanup patterns elsewhere in `worktree.ts`.

### Test Gaps
- No tests were added for failure-path behavior (e.g., `git rev-list` failure, saved-branch create failure, collision with different SHA) before inter-wave reset.
- No test currently verifies that failed preservation attempts do not proceed into destructive reset/deletion.

### Suggestions
- Add focused tests in `extensions/tests/partial-progress.test.ts` for: save failure handling, idempotent re-runs, workspace naming (`repoId` included), and inter-wave reset safety.
- Log per-task preservation failures (`taskId`, `laneBranch`, `repoId`, `error`) so operators can recover quickly.
