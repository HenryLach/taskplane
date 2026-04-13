## Plan Review: Step 1: Segment-Scoped Iteration Prompt

### Verdict: APPROVE

### Summary
The Step 1 plan covers the required outcomes from PROMPT.md and spec A.2: segment-scoped checkbox visibility, explicit segment context in the iteration prompt, other-segment guardrails, repo-filtered remaining steps, and legacy fallback behavior. The proposed helper structure is reasonable for keeping prompt assembly logic readable. This is sufficient to proceed without blocking changes.

### Issues Found
1. **[Severity: minor]** The planned `getRepoIdFromSegmentId(segmentId)` helper should avoid brittle string parsing assumptions (e.g., possible `::N` suffix on segment IDs). Prefer using existing repo identity already available on the execution unit when possible, or implement parsing defensively.

### Missing Items
- None blocking for Step 1 outcomes.

### Suggestions
- Add at least one targeted test case where segment-scoped prompt filtering is active and one legacy case (no `stepSegmentMap`) to lock in backward compatibility.
- In prompt copy, keep the “NOT yours — do not attempt” wording close to the spec language for operator/debug consistency.
