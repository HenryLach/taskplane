## Code Review: Step 4: Sidecar Telemetry Update

### Verdict: REVISE

### Summary
The Step 4 changes correctly wire segment-scoped progress into runtime snapshots and update the dashboard progress cell to prefer V2 snapshot progress for the active task, which addresses the key visibility gap from the prior plan reviews. However, the update introduces a blocking runtime error in the terminal snapshot path: `makeResult()` now references `snapshotSegmentCtx` that is out of scope. This will throw at task completion/failure and can crash lane-runner execution.

### Issues Found
1. **[extensions/taskplane/lane-runner.ts:1167] [critical]** `makeResult()` calls `emitSnapshot(..., snapshotSegmentCtx)`, but `snapshotSegmentCtx` is declared inside `executeTaskV2()` (`lane-runner.ts:326`) and is not in scope within `makeResult()`. This causes a `ReferenceError` when `makeResult()` runs with snapshot emission enabled (normal path), breaking task termination handling.  
   **Suggested fix:** Add `snapshotSegmentCtx` as an explicit optional parameter to `makeResult(...)` and pass it from each `executeTaskV2` call site, or remove the terminal-call argument and compute context inside `makeResult` from passed-in data.

### Pattern Violations
- None.

### Test Gaps
- No runtime/behavioral test currently executes the `makeResult()` snapshot-emission path, which is why the out-of-scope reference regressed undetected.
- No dashboard-focused regression test verifies that active running task progress prefers V2 snapshot counts over `task.statusData` full-task counts.

### Suggestions
- Add a focused lane-runner test that exercises a real `executeTaskV2` completion/failure return path with snapshot emission enabled to catch terminal snapshot regressions.
- Add a dashboard rendering test (or narrow unit around progress-cell logic) for mixed full-task vs segment-scoped counts to lock in the TP-174 behavior.
