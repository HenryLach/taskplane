## Code Review: Step 2: Implement Segment Parsing

### Verdict: REVISE

### Summary
This revision closes the blockers from R005/R006 (fallback placeholder routing, repo-mode normalization, and unknown-repo suggestion hints), and the step-segment mapping is now wired through discovery end-to-end. However, there is still one correctness issue that can silently drop checkbox work from `stepSegmentMap` for malformed segment repo IDs. That violates the spec’s non-fatal-warning intent for bad/unknown segment IDs and can cause downstream segment-scoped execution to miss required work.

### Issues Found
1. **[extensions/taskplane/discovery.ts:485-525] [important]** — Invalid segment repo IDs are warned and then skipped (`continue`), which drops that segment’s checkboxes from `stepSegmentMap`. Repro: `#### Segment: api_service` with `- [ ] do work` yields `segments: []` for the step (warning present, work lost). This is unsafe because non-fatal diagnostics should not remove actionable checkbox content.  
   **Fix:** Do not discard the segment block when repo format is invalid. Still extract and keep its checkboxes in the mapping (with warning), or make invalid-format segment IDs a hard parse error. The current “warning + drop content” behavior should be avoided.

### Pattern Violations
- None noted.

### Test Gaps
- No tests were added for `parseStepSegmentMapping` parser behavior.
- Missing regression test for malformed segment repo token preserving checkbox extraction (or explicitly failing fast if you choose hard-error semantics).

### Suggestions
- Add focused parser tests in `extensions/tests/discovery-routing.test.ts` (or a dedicated discovery parser test file) for:
  - malformed repo token segment (`api_service`) with checkboxes,
  - explicit unknown repo segment retaining checkboxes plus warning,
  - duplicate detection behavior when malformed and valid segment headers coexist.
