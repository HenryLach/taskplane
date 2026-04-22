## Code Review: Step 3: Dashboard server — include reviewer in laneStates synthesis

### Verdict: APPROVE

### Summary
This change correctly implements the Step 3 outcome in `buildDashboardState()`: `snap.reviewer` is now mapped into the legacy flat `laneStates` reviewer fields consumed by the existing dashboard UI. The defaults when reviewer data is absent (`idle` + zero/empty metrics) are safe and avoid stale values. Based on this diff, reviewer sub-row activation (`reviewerStatus === "running"` with matching `taskId`) should now work as intended for V2 snapshots.

### Issues Found
1. **[dashboard/server.cjs:1049-1077] [minor]** No blocking correctness issues found for this step’s stated outcomes.

### Pattern Violations
- None observed.

### Test Gaps
- No focused regression test yet for V2 snapshot synthesis where `snap.reviewer.status = "running"` to verify `laneStates[*].reviewerStatus/reviewerElapsed/reviewerToolCount/...` are populated.
- No focused regression test yet for `snap.reviewer = null` to verify synthesized reviewer fields revert to neutral defaults (`idle`, `0`, `""`).

### Suggestions
- Consider whether reviewer terminal failures (`crashed`, `killed`, `timed_out`) should map to `"error"` instead of `"done"` for semantic parity with worker mapping and legacy reviewer status conventions.