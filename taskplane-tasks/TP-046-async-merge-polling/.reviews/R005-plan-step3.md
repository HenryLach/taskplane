## Plan Review: Step 3: Convert mergeWave and Callers to Async

### Verdict: REVISE

### Summary
The plan is close and targets the main async propagation path (`mergeWave`, `mergeWaveByRepo`, engine/resume callers). However, it misses one explicit Step 3 requirement from the task prompt and leaves a race-risk area underspecified when converting `spawnMergeAgent` to async. Tightening these items now will prevent regressions in merge liveness/timeout behavior.

### Issues Found
1. **[Severity: important]** — The plan does not explicitly include converting the remaining merge cleanup delays in `merge.ts` from `sleepSync(500)` to async delay, even though this is a stated Step 3 requirement (“Convert `sleepSync(500)` delay calls in merge worktree cleanup to async where possible”). Add explicit coverage for the stale merge-worktree retry delay and post-cleanup delay paths.
2. **[Severity: important]** — The plan says to make `spawnMergeAgent` async, but does not explicitly call out updating all `spawnMergeAgent(...)` call sites to `await` in the merge retry loop. Without this, `waitForMergeResult()` can begin while spawn-retry/backoff is still in flight, causing session-liveness races and incorrect timeout/failure handling.

### Missing Items
- Explicit plan item for converting **all remaining merge-path `sleepSync` calls in Step 3 scope** (not only retry backoff), including cleanup-related 500ms delays.
- Explicit plan item to `await` `spawnMergeAgent()` at both initial and retry invocation sites inside `mergeWave()`.

### Suggestions
- After async conversion, update stale wording/comments that still describe merge calls as synchronous (e.g., in `engine.ts`) to avoid future maintenance confusion.
