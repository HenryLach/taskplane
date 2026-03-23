## Plan Review: Step 2: Convert waitForMergeResult to Async

### Verdict: REVISE

### Summary
The plan is close, but it currently under-specifies one required outcome from `PROMPT.md` Step 2. It covers making `waitForMergeResult` async and replacing the main poll sleep, but it does not explicitly include converting the second blocking delay in the same function (the invalid-result retry delay). Without that, this step may leave residual event-loop blocking in the merge wait path.

### Issues Found
1. **[Severity: important]** — The Step 2 plan only mentions replacing `sleepSync` in the polling loop, but `PROMPT.md` explicitly requires replacing both `sleepSync(MERGE_POLL_INTERVAL_MS)` and `sleepSync(MERGE_RESULT_READ_RETRY_DELAY_MS)` in `waitForMergeResult()`. Add the second conversion explicitly so this step fully meets the requirement.

### Missing Items
- Explicitly include converting the `MERGE_RESULT_READ_RETRY_DELAY_MS` sleep in `waitForMergeResult()` to `await sleepAsync(...)` (invalid/partial result retry path).

### Suggestions
- Keep the TP-038 timeout/retry/grace semantics called out as a non-regression check while refactoring control flow to `async/await`.
