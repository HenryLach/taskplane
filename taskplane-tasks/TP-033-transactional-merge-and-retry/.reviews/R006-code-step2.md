## Code Review: Step 2: Retry Policy Matrix

### Verdict: REVISE

### Summary
The retry-matrix scaffolding is in place (classification, policy table, persisted counters, and engine/resume integration), and the full suite currently passes. However, the runtime control flow does not actually enforce the matrix semantics in several critical paths: retry attempts are not exhausted correctly, and exhaustion does not reliably force `paused` as required. These gaps mean the behavior diverges from the Step 2 outcomes even though the plumbing exists.

### Issues Found
1. **[extensions/taskplane/engine.ts:581-686, extensions/taskplane/resume.ts:1558-1651] [critical]** — Retry execution stops after a single retry attempt, regardless of `maxAttempts`.
   - The code computes `retryDecision` once, performs at most one retry, then immediately falls into `computeMergeFailurePolicy(...)` on another failure.
   - This breaks matrix behavior for classes like `git_lock_file` (`maxAttempts: 2`), and also drops exhaustion diagnostics after a failed retry for `maxAttempts: 1` classes.
   - **Fix:** Wrap merge retry handling in a loop: after each failed retry, re-classify the latest `mergeResult`, recompute decision using persisted count, and continue until success, rollback safe-stop, or `shouldRetry === false`.

2. **[extensions/taskplane/engine.ts:668-685, extensions/taskplane/resume.ts:1634-1651] [critical]** — Exhaustion action from the retry matrix is ignored; terminal handling still defers to `on_merge_failure` pause/abort policy.
   - Step requirement is explicit: on retry exhaustion, enter `paused` with diagnostic context.
   - Current code can transition to `stopped` when config is `on_merge_failure: abort`, which violates matrix semantics and roadmap exhaustion actions.
   - **Fix:** When `retryDecision.shouldRetry === false` for a classified merge failure, force `batchState.phase = "paused"` and emit matrix-specific diagnostics (`classification`, attempts, scope key), rather than routing through `computeMergeFailurePolicy`.

3. **[extensions/taskplane/engine.ts:570-576, extensions/taskplane/resume.ts:1548-1553] [important]** — Retry scope key can lose repo scoping for setup failures (`failedLane === null`).
   - Repo ID is derived only from lane results; setup failures often have no lane result and become `default:w{N}:l0` even in workspace mode.
   - This violates `(repoId, wave, lane)` scoping intent and can cross-contaminate counters between repos.
   - **Fix:** Add repo fallback extraction from `mergeResult.repoResults` / prefixed failure metadata when lane-level repo is unavailable.

### Pattern Violations
- None blocking, but the retry block is duplicated in engine/resume instead of centralized; this increases drift risk for resilience logic.

### Test Gaps
- No focused tests for retry matrix runtime behavior were added in this step. Missing scenarios include:
  - `git_lock_file` performs two retries before exhaustion.
  - Exhaustion forces `paused` even when `on_merge_failure=abort`.
  - Failed retry path includes exhaustion diagnostics (`classification`, attempt/max, scope key).
  - Repo-scoped counter keying for workspace setup failures with `failedLane=null`.

### Suggestions
- Consider extracting a shared `applyMergeRetryPolicy(...)` helper used by both engine and resume to preserve parity over time.
