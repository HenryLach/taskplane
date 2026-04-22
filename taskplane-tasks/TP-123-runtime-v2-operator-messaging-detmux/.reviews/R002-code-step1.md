## Code Review: Step 1: Replace operator guidance strings

### Verdict: APPROVE

### Summary
Step 1 implementation matches the stated outcomes: operator-facing `tmux attach` guidance was replaced in extension formatting, TMUX-centric session wording was made backend-neutral, and legacy migration context was retained only where compatibility warnings are still relevant. The changes are string-only and do not alter runtime/control flow behavior. I do not see blocking correctness issues for this step.

### Issues Found
1. None.

### Pattern Violations
- None observed.

### Test Gaps
- No step-local tests were updated in this commit. That is acceptable for Step 1 since test updates are explicitly planned in Step 3, but those assertions should be updated to lock in the new operator wording.

### Suggestions
- As noted in the plan review, consider tightening terminology consistency across strings (`orchestrator sessions` vs `lane sessions`) so users see one canonical phrase family.
- In Step 3, add/adjust assertions for `buildDashboardViewModel().attachHint`, `ORCH_MESSAGES.sessionsNone`, and startup/preflight notices so future copy regressions are caught early.
