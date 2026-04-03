## Plan Review: Step 2: Tests

### Verdict: APPROVE

### Summary
The Step 2 test plan directly targets the TP-127 regression and the expected monitor-liveness behavior at wave transitions. The three planned cases cover the key decision branches introduced by the fix: stale mismatched snapshot, current running snapshot, and current terminal snapshot. This is sufficient to validate correctness for the scoped bug fix.

### Issues Found
1. **[Severity: minor]** — No blocking issues found.

### Missing Items
- None.

### Suggestions
- In the stale-snapshot test, make the stale snapshot explicitly terminal (for example `status: "complete"` with a different `taskId`) so the test proves task-id mismatch takes precedence over snapshot status.
- If practical, assert both `sessionAlive` and the resulting monitor `status` to ensure the behavior is validated end-to-end at the `resolveTaskMonitorState` output level.
