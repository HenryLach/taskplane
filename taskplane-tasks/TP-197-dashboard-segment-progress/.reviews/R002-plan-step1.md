## Plan Review: Step 1: Plan the API + visual design

### Verdict: APPROVE

### Summary
The revised Step 1 plan now covers the required API shape, rendering approach, progress semantics, and responsive behavior with enough specificity to implement safely. It directly addresses the prior R001 blocker by moving segment pills out of `.task-step` and defining a row-3 placement that remains visible at narrow widths. The scope is appropriately constrained to TP-197’s UX goal and preserves single-segment behavior.

### Issues Found
1. **[Severity: minor]** — No blocking issues found.

### Missing Items
- None.

### Suggestions
- During implementation, keep a small guard in place for stale/missing `v2Progress` so segmented running tasks still avoid looking like overall-task progress in edge cases (for example, by preferring segment-context text/pills even when progress falls back).
