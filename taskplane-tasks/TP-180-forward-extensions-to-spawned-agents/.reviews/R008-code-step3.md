## Code Review: Step 3: Wire extensions into all three spawn points

### Verdict: APPROVE

### Summary
Step 3’s wiring now looks correct end-to-end: worker, reviewer, and merge spawn paths all forward discovered extensions while preserving `--no-extensions`, and exclusion lists are threaded through runtime execution/retry/resume paths. I also verified the prior blocking issue from R007 is resolved (the `mergeStateRoot` redeclaration in `merge.ts` is no longer present). Full extension test suite execution passed at HEAD.

### Issues Found
1. **[None] [minor]** — No blocking correctness issues found in this step.

### Pattern Violations
- None observed.

### Test Gaps
- Step 5 should still add dedicated regression tests for extension forwarding/exclusion behavior across worker/reviewer/merge and retry/resume paths (as planned).

### Suggestions
- Add a targeted unit test for reviewer forwarding fallback behavior (`TASKPLANE_STATE_ROOT` absent → uses reviewer `cwd`) to lock in the worktree-safe resolution logic.
