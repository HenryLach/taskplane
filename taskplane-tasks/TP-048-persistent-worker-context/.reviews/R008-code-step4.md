## Code Review: Step 4: Integrate reviews with the new loop

### Verdict: REVISE

### Summary
The core Step 4 refactor is mostly in place: up-front plan-review sweep was removed and reviews are now driven from the post-worker newly-completed transition loop. However, there is a blocking pause-flow gap: review execution is currently gated on `state.phase === "running"`, which causes newly completed steps to skip both plan and code review when `/task-pause` is requested during a worker iteration. On resume, those steps are already complete and no longer transition, so their reviews never run.

### Issues Found
1. **[extensions/task-runner.ts:2150] [important]** — Reviews are skipped when the task is paused after worker exit. `/task-pause` intentionally sets `state.phase = "paused"` before the current worker finishes (`extensions/task-runner.ts:3282-3291`), but post-worker reviews only run under `state.phase === "running"`. This allows completed steps to bypass review entirely after resume because they are no longer `incomplete -> complete` transitions. **Fix:** allow post-worker transition reviews to run while paused (e.g., gate on `state.phase !== "error"` or `state.phase === "running" || state.phase === "paused"`), then honor pause by returning before launching the next worker iteration.

### Pattern Violations
- None beyond the pause/review-state coupling above.

### Test Gaps
- No regression test covers: pause requested mid-iteration, worker completes a step, and post-worker plan/code reviews still execute before the loop returns paused.

### Suggestions
- Add an integration test asserting that a paused iteration still logs `Review R###` entries for newly completed steps and preserves REVISE → rework behavior on resume.
