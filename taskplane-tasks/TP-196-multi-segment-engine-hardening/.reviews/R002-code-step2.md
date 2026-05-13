## Code Review: Step 2: Implement #502 first (foundational refactor)

### Verdict: REVISE

### Summary
The refactor successfully introduces `SegmentScopeMode` as a first-class type and a centralized `computeSegmentScopeMode(...)` helper, and quality gates are green (`npm run typecheck`, `npm run lint`, `npm run format:check` all exit 0). However, one of the main #502 outcomes is still incomplete: prompt-scoping logic continues to use the old composite condition directly instead of deriving from the new authoritative mode. This leaves exactly the drift surface TP-196/#502 is intended to eliminate.

### Issues Found
1. **[extensions/taskplane/lane-runner.ts:556] [important]** — Segment-scoped prompt injection is still gated by `if (stepSegmentMap && currentRepoId && repoStepNumbers && remainingSteps.length > 0)` rather than `segmentScopeMode`/`isSegmentScoped`. This duplicates the decision logic after introducing `computeSegmentScopeMode(...)`, so future edits can still diverge between mode computation and prompt behavior. **Fix:** gate this block with `isSegmentScoped` (or `segmentScopeMode === "SEGMENT_SCOPED"`) and treat any missing mapping as an internal inconsistency path (e.g., guarded early-return/log) rather than a separate mode decision.
2. **[extensions/tests/segment-scoped-lane-runner.test.ts:398] [important]** — Test `7.3` hard-codes the legacy raw condition string, which now enshrines the drift-prone pattern and will resist completing #502 properly. **Fix:** replace this source-string assertion with one that validates mode-derived gating (e.g., presence of `isSegmentScoped` gate or behavior-level assertion for FULL_TASK vs SEGMENT_SCOPED prompt injection).

### Pattern Violations
- The new helper’s contract says segment side-effects should derive from authoritative mode, but one prompt branch still re-evaluates raw prerequisites inline.

### Test Gaps
- No assertion currently verifies that the segment-scoped prompt block is controlled by `SegmentScopeMode` rather than by duplicated boolean conditions.

### Suggestions
- This review aligns with the Step 1 plan-review suggestion (R001) to avoid leaving ad-hoc parallel checks behind; once the above gate is mode-driven, the #502 foundational goal is fully realized.
