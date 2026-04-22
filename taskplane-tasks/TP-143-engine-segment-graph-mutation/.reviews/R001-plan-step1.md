## Plan Review: Step 1: Outbox consumption at segment boundaries

### Verdict: APPROVE

### Summary
The Step 1 plan covers the core required outcomes: boundary-time outbox scan, request parsing, malformed handling, failed-segment discard behavior, and deterministic ordering. It is appropriately scoped for an outcome-level plan and aligns with the TP-143 prompt/spec intent for initial engine-side consumption behavior. I don’t see any blocking gaps that would prevent successful implementation of this step.

### Issues Found
1. **[Severity: minor]** — The STATUS checklist does not explicitly mention emitting a supervisor alert when requests are discarded due to originating segment failure (called out in PROMPT/spec). Suggested fix: add this explicitly in Step 1 notes/checklist to reduce omission risk.

### Missing Items
- None blocking for Step 1 outcomes.

### Suggestions
- Consider explicitly noting that the scan path is the **completing agent’s** outbox (`.pi/mailbox/{batchId}/{agentId}/outbox/segment-expansion-*.json`) to avoid accidentally scanning broader mailbox scope.
- Add a brief test-intent note for this step (even if full test authoring remains in Step 6), especially around mixed valid/invalid files and deterministic request ordering.
