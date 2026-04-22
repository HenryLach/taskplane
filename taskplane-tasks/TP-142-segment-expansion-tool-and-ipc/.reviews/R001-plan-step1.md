## Plan Review: Step 1: Extend SegmentId grammar in types.ts

### Verdict: APPROVE

### Summary
The Step 1 plan covers the required outcomes for this slice: extending `buildSegmentId()` with sequence support, introducing a structured repo extraction helper, adding the `SegmentExpansionRequest` contract, and adding a request ID builder. This is appropriately scoped to `types.ts` and aligns with the TP-142 spec intent. I don’t see blocking gaps that would prevent the step from succeeding.

### Issues Found
1. **[Severity: minor]** — The item “buildSegmentId with optional sequence” could be interpreted too broadly; it should explicitly preserve the spec rule that suffix `::N` is only appended for `N >= 2` (never `::1`). Suggested fix: call this behavior out directly in the implementation notes/tests.

### Missing Items
- None blocking.

### Suggestions
- Add a targeted unit check for `buildSegmentId(task, repo, 1)` to ensure backward-compatible output remains `task::repo`.
- While touching `types.ts`, quickly audit nearby segment-ID parsing helpers to avoid introducing or reinforcing string-splitting patterns where structured repo fields are available.
