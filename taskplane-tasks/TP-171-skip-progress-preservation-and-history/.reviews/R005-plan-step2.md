## Plan Review: Step 2: Fix Batch History Task Gap

### Verdict: APPROVE

### Summary
The Step 2 plan is aligned with the required outcomes in PROMPT.md: it explicitly targets full wave-plan coverage in batch history, includes skipped/failed/never-started cases, and calls out the known edge around wavePlan vs `allTaskOutcomes` mismatches. The proposed checks also reflect the discovery notes from Step 0, especially around dynamic expansion and potentially incomplete blocked-task tracking. This should achieve the step’s functional goal if implemented as written.

### Issues Found
1. **[Severity: minor]** The current test line item (`tests/batch-history-persistence.test.ts`) should ensure it exercises the **engine batch-history construction path** (where the gap occurs), not only `saveBatchHistory()` I/O behavior.

### Missing Items
- None blocking for Step 2 outcomes.

### Suggestions
- Add at least one regression scenario with a mixed outcome set in one wave (succeeded + failed + skipped + never-started/blocked) and assert all planned task IDs are present in `summary.tasks`.
- Include one dynamic-expansion case where an outcome task ID is not in the original `wavePlan`, and verify behavior is deterministic (included with expected wave/lane semantics and no planned task dropped).
