## Code Review: Step 3: Segment Exit Condition

### Verdict: REVISE

### Summary
The Step 3 change correctly introduces segment-scoped completion checks for loop exit and post-loop success/failure evaluation. However, the iteration step-selection path still keys off full-step completion, so segment-complete steps can remain the active step when other repos’ segment checkboxes are still open. That prevents the intended “advance to next step for this repo” behavior and can drive false no-progress failures.

### Issues Found
1. **[extensions/taskplane/lane-runner.ts:349-355] [critical]** `remainingSteps` still filters using `isStepComplete(ss)` (full-step/global), not segment completion. In segment-scoped execution, a step where this repo’s segment is already complete but other segment blocks are not will continue to appear as the first remaining step. This violates the Step 3 requirement to advance to the next repo-owned step and can trap the worker on an already-finished segment until stall limit.  
   **Suggested fix:** In the `repoStepNumbers && currentRepoId` branch, derive “remaining for this segment” with `!isSegmentComplete(statusContent, step.number, currentRepoId)` (using current STATUS.md text), while preserving current global `isStepComplete` behavior for non-segment/legacy mode.

### Pattern Violations
- None.

### Test Gaps
- Missing regression test: segment-scoped task where repo A owns multiple steps and an earlier step also has repo B checkboxes. After repo A finishes its segment in step N, lane-runner should advance to repo A’s next step (not repeat step N).
- Missing regression test: same scenario should not increment stall/no-progress due to repeatedly targeting an already-complete segment block.

### Suggestions
- Consider reusing one “step done predicate” per mode (global vs segment-scoped) and using it consistently for `remainingSteps`, “completed for repo” prompt context, and loop-exit checks to avoid divergence.
