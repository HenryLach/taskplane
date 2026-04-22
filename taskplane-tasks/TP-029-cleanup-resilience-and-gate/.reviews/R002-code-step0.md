## Code Review: Step 0: Preflight

### Verdict: REVISE

### Summary
The preflight findings added to `STATUS.md` are useful and align with the R001 plan feedback, but this checkpoint still has two blocking hygiene issues. One is a malformed Reviews table in the TP-029 status file, and the other is an unrelated edit to TP-028 that should not be part of this step. Please fix those and resubmit.

### Issues Found
1. **[taskplane-tasks/TP-029-cleanup-resilience-and-gate/STATUS.md:77-79] [important]** — Reviews table rows are in the wrong order (`data row` appears before the Markdown separator row). This breaks table rendering/parsing consistency with other task STATUS files. **Fix:** reorder to `header -> separator -> data rows`.
2. **[taskplane-tasks/TP-028-partial-progress-preservation/STATUS.md:75] [important]** — Step 0 for TP-029 includes an unrelated change in another task folder (`TP-028` `.DONE` checkbox). This creates cross-task coupling and review noise. **Fix:** revert this line from the TP-029 step commit (or move it to the correct task-specific change set).

### Pattern Violations
- STATUS review table format deviates from the project’s standard task template ordering.
- Step-scoped change set includes unrelated task-folder mutation.

### Test Gaps
- No runtime code changed in this step; test execution is not required for this preflight-only checkpoint.

### Suggestions
- Add a `Step 0 complete` entry in the execution log once this review passes to keep lifecycle transitions explicit.
