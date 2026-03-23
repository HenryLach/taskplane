## Code Review: Step 3: Convert mergeWave and Callers to Async

### Verdict: APPROVE

### Summary
The Step 3 changes correctly convert `spawnMergeAgent` to async and propagate `await` at all in-function call sites (`extensions/taskplane/merge.ts`), including retry/backoff and stale-session delay behavior. Remaining merge cleanup delays in `mergeWave` were also moved to `sleepAsync`, which aligns with the goal of avoiding event-loop blocking during merge operations. I also verified caller consistency and found `mergeWaveByRepo` already awaited in `engine.ts` and `resume.ts`.

### Issues Found
1. **[N/A] [minor]** — No blocking correctness issues found in this step’s code changes.

### Pattern Violations
- None observed.

### Test Gaps
- No step-specific gaps identified. Targeted merge test suites pass:
  - `npx vitest run tests/merge-timeout-resilience.test.ts`
  - `npx vitest run tests/merge-*.test.ts tests/transactional-merge.test.ts`

### Suggestions
- Optional follow-up (non-blocking): consider a future pass to evaluate whether `parseMergeResult()` retry delays (`sleepSync`) should also become async for complete non-blocking behavior, even though they are short and bounded.
