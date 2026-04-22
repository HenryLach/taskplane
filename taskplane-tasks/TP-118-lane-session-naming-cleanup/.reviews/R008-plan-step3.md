## Plan Review: Step 3: Rename in tests

### Verdict: APPROVE

### Summary
This revised Step 3 plan now captures the key outcome that was missing in R007: non-compat test references should be renamed while legacy `tmuxSessionName` coverage is intentionally preserved. The added checkpoints in `STATUS.md` (lines 39–41) align with the task’s backward-compatibility requirement in `PROMPT.md` line 94. The plan is now outcome-complete and safe to execute.

### Issues Found
1. **[Severity: minor]** — No blocking issues found.

### Missing Items
- None.

### Suggestions
- After the test rename pass, log a short grep summary grouped by test file to make compatibility-scoped leftovers explicit and easy to review.
