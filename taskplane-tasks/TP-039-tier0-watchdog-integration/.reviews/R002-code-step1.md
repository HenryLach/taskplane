## Code Review: Step 1: Wire Automatic Recovery into Engine

### Verdict: REVISE

### Summary
The step adds the intended Tier 0 hooks (worker retry, stale-worktree retry, cleanup-gate retry) and correctly extends `WaveExecutionResult` with structured allocation errors. However, there are correctness issues in the retry decision path and wave-state bookkeeping that can cause incorrect retries and permanently skipped downstream tasks. These issues need to be fixed before this step is safe to rely on.

### Issues Found
1. **[extensions/taskplane/engine.ts:81-89] [critical]** Worker-failure classification is effectively hardcoded to `session_vanished` for most failures.
   - `classifyExit()` is called with `exitSummary: null` and all other signals set to false/null, so any failed task with `doneFileFound=false` classifies as `session_vanished` (retryable), regardless of actual cause.
   - This causes retries for non-retryable failures (e.g., deterministic task errors, user kill/abort, stall), violating the retry matrix intent.
   - **Fix:** Use real structured diagnostics (`outcome.exitDiagnostic.classification`) from execution path; if unavailable, do **not** infer `session_vanished` from null input. Either plumb exit summaries/diagnostics into outcomes or conservatively skip auto-retry when classification is unknown.

2. **[extensions/taskplane/engine.ts:655-658, 157-160] [critical]** Dependents can remain permanently blocked even when the failed task is recovered by Tier 0 retry.
   - `blockedTaskIds` are added to batch state before worker-retry reconciliation, but retry success only updates `failedTaskIds/succeededTaskIds`; blocked sets are never recomputed/unwound.
   - In `skip-dependents` mode, this can incorrectly skip future-wave tasks whose dependency was actually recovered.
   - **Fix:** Perform retry reconciliation before applying blocked tasks, or recompute `waveResult.blockedTaskIds` from remaining failures after retries and sync `batchState.blockedTaskIds` accordingly.

3. **[extensions/taskplane/engine.ts:271-279] [important]** Stale-worktree recovery cleanup targets only the primary `repoRoot`, not workspace repos.
   - Allocation failures can come from non-default repos (see `waves.ts:1057` message includes failing repo), but recovery only runs `listWorktrees/forceCleanup/prune` in the primary root.
   - In workspace mode this can exhaust retry budget without actually cleaning the failing repo.
   - **Fix:** Scope cleanup to the repo(s) implicated by allocation failure (parse repo ID/details), or iterate all workspace repos for batch-scoped stale worktrees before retry.

4. **[extensions/taskplane/engine.ts:665, extensions/taskplane/execution.ts:1894-1901] [important]** Worker retry is skipped when `stop-wave` policy sets `pauseSignal.paused=true`.
   - `executeWave()` sets pause on failure for `stop-wave`; engine then gates Tier 0 retry behind `!batchState.pauseSignal.paused`.
   - This prevents the automatic recovery path from running under `stop-wave`, contrary to the step goal of recovering session crashes before pausing.
   - **Fix:** Distinguish user/operator pause from policy-induced pause, and allow Tier 0 retry flow to run for policy pauses before final stop decision.

### Pattern Violations
- Retry policy decisions should be driven by canonical diagnostics (`exitDiagnostic.classification`) where available; constructing classification from a synthetic null `ExitClassificationInput` bypasses established diagnostics semantics.

### Test Gaps
- No regression test for: recovered failed task should unblock downstream dependents in `skip-dependents` mode.
- No workspace-mode test for stale-worktree allocation failure in a non-default repo.
- No test asserting non-retryable failures are not retried (e.g., user kill / deterministic task error).

### Suggestions
- Persist Tier 0 retry counters immediately per attempt (not only at end-of-loop) to improve crash-resilience of retry accounting.
