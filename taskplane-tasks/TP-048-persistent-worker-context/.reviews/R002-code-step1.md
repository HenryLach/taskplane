## Code Review: Step 1: Restructure the step loop to spawn worker once per task

### Verdict: REVISE

### Summary
The loop refactor successfully moves worker spawning to iteration scope and updates the worker prompt to include all remaining steps. However, there is a blocking correctness issue in the new completion logic: a step marked back to `in-progress` after a `REVISE` verdict is still treated as complete when all its checkboxes are checked. That causes premature task completion and prevents the intended rework-on-next-iteration behavior.

### Issues Found
1. **[extensions/task-runner.ts:2004-2006, 2024-2026, 2084, 2096-2100] [critical]** — `REVISE` rework is bypassed by checkbox-based completion heuristics. After code review returns `REVISE`, the code sets step status to `in-progress` (`updateStepStatus(..., "in-progress")`), but `remainingSteps`/`completedBefore`/`allComplete` still consider `totalChecked === totalItems` as complete. Result: revised steps are excluded from the next worker pass and the task can exit as complete anyway. **Fix:** make completion checks respect explicit rework state (e.g., track a `needsRework` set, or treat `status === "in-progress"` as authoritative non-complete even when all checkboxes are checked) in all three places.

### Pattern Violations
- None beyond the blocking logic mismatch above.

### Test Gaps
- Missing regression test for: code review returns `REVISE` after a step is marked complete; next iteration must include that step again and must not allow task-level `allComplete` to pass.
- Missing regression test for: step with all checkboxes checked but explicit `in-progress` status should remain incomplete for scheduling/completion checks.

### Suggestions
- Add a small shared helper for step completion classification (instead of repeating inline checks) so review-state rules stay consistent across `remainingSteps`, `completedBefore`, `newlyCompleted`, and `allComplete`.
