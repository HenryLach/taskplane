## Plan Review: Step 1: Add merge snapshot infrastructure

### Verdict: APPROVE

### Summary
The Step 1 plan is well-scoped and matches the task outcome: introduce a dedicated merge snapshot contract and persistence helpers without changing existing lane semantics. The proposed additions in `types.ts` and `process-registry.ts` follow established project patterns (`RuntimeLaneSnapshot`, `writeLaneSnapshot`, `readLaneSnapshot`) and provide the needed foundation for Step 2/3 telemetry wiring. I do not see blocking gaps for this step.

### Issues Found
1. **[Severity: minor]** — No blocking issues found for Step 1.

### Missing Items
- None identified for Step 1 outcomes.

### Suggestions
- Consider adding a small unit test around `writeMergeSnapshot`/`readMergeSnapshot` round-trip behavior (including nonexistent/corrupt file cases), mirroring the resilience expectations already used by lane snapshots.
- Keep JSDoc and field semantics aligned with existing `RuntimeLaneSnapshot`/`RuntimeAgentTelemetrySnapshot` terminology to avoid drift in downstream dashboard code.
