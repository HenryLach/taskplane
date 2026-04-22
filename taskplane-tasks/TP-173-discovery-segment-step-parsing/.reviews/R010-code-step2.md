## Code Review: Step 2: Implement Segment Parsing

### Verdict: APPROVE

### Summary
This revision addresses the prior blockers (including R009’s `## Steps` boundary issue) and now wires step-segment parsing through discovery, routing-time normalization, and diagnostics end-to-end. Fallback-to-primary repo handling is implemented via placeholder resolution in both workspace and repo modes, and duplicate repo IDs within a step are treated as fatal discovery errors. Unknown segment repo IDs are emitted as non-fatal diagnostics with best-effort suggestions, which matches the Step 2/spec intent.

### Issues Found
1. **[extensions/taskplane/discovery.ts:399-559, 1554-1742] [minor]** — No blocking correctness issues found in this step’s implementation.

### Pattern Violations
- None noted.

### Test Gaps
- No new tests were added in this change for `parseStepSegmentMapping`/`stepSegmentMap` behavior (fallback grouping, duplicate-in-step, empty segment warning, unknown repo warning path, post-`## Steps` boundary regression).

### Suggestions
- Add focused parser/routing tests in Step 3 to lock in the new behaviors and prevent regressions, especially:
  - post-`## Steps` checklist isolation,
  - repo-mode placeholder normalization + duplicate detection,
  - workspace unknown-repo warning message with suggestions.
