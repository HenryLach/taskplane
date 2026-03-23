## Code Review: Step 2: Convert waitForMergeResult to Async

### Verdict: REVISE

### Summary
`waitForMergeResult` was correctly converted to `async` and the blocking sleeps inside it were replaced with `await sleepAsync(...)`. However, the main caller in `mergeWave` still invokes it synchronously, so the merge flow now treats a `Promise` as a concrete merge result. This breaks timeout/retry/error semantics and can let the lane continue before merge completion.

### Issues Found
1. **[extensions/taskplane/merge.ts:1252] [critical]** — `waitForMergeResult(...)` is now `async`, but it is called without `await` inside a synchronous `try/catch`. As a result, `mergeResult` becomes a `Promise`, the timeout retry logic no longer catches `MERGE_TIMEOUT`, and downstream status checks (`mergeResult.status`) run against `undefined` rather than a real `MergeResult`. **Fix:** make this call awaited (`await waitForMergeResult(...)`) and propagate async conversion through `mergeWave` and its callers so retry/timeout behavior is preserved.

### Pattern Violations
- Step requirement “Preserve the retry-on-timeout loop (TP-038)” is currently violated because asynchronous rejections from `waitForMergeResult` bypass the existing synchronous `catch` path.

### Test Gaps
- Existing tests did not catch the un-awaited call path in `mergeWave`. Add an execution-level test that verifies `mergeWave` blocks on merge completion and that `MERGE_TIMEOUT` from `waitForMergeResult` is handled by the retry loop.

### Suggestions
- After async propagation, add a regression assertion that lane results always store a concrete `MergeResult` object (never a `Promise`).
