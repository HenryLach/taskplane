## Code Review: Step 4: Remove aliases

### Verdict: APPROVE

### Summary
The Step 4 follow-up addresses the prior blocker from R012: dashboard ingress now normalizes legacy lane records from `tmuxSessionName` to canonical `laneSessionId` before state is used. The implementation is scoped to ingestion (`loadBatchState`) and removes the legacy field after mapping, which aligns with the step goal of alias removal while preserving backward compatibility for old persisted state.

### Issues Found
1. None.

### Pattern Violations
- None identified.

### Test Gaps
- No blocking gaps. Added regression checks in `extensions/tests/orch-rpc-telemetry.test.ts` verify both normalization logic presence and that `loadBatchState()` applies it.

### Suggestions
- Optional hardening: add one behavior-level test (fixture/object in -> normalized object out) for dashboard ingestion, to complement current source-extraction assertions.