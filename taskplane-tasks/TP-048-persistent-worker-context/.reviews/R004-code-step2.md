## Code Review: Step 2: Update worker prompt for multi-step execution

### Verdict: APPROVE

### Summary
The Step 2 implementation meets the stated outcomes: the worker prompt now targets all remaining steps, includes explicit completion/skip status in the step list, and instructs per-step commit plus wrap-up checks between steps. Both worker templates were updated to remove stale single-step guidance and align with multi-step execution/resume behavior. I also spot-checked related task-runner tests, and they pass.

### Issues Found
1. **[extensions/task-runner.ts:931] [minor]** `git log` uses both `--oneline` and `--format=%H`; `--oneline` is redundant here. Suggested fix: remove `--oneline` to make intent clearer and avoid mixed formatting flags.

### Pattern Violations
- None observed.

### Test Gaps
- No targeted test currently validates the new worker prompt content (all-steps listing + `[already complete — skip]` annotation).
- No targeted test currently validates step-boundary baseline propagation when multiple steps are completed in one worker iteration.

### Suggestions
- Add focused tests around prompt construction in `runWorker()` to lock in the new multi-step instruction contract.
- Consider extending review diff generation to support an explicit upper commit boundary for step-specific diffs when several steps complete in one iteration.
