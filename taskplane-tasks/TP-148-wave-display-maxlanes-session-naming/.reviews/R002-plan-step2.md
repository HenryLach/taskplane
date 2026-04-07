## Plan Review: Step 2 — Global maxLanes cap

### Verdict: APPROVE

### Summary
The plan correctly identifies the integration point in `allocateLanes()` (between Stage 2 per-repo assignment and Stage 3 worktree creation) and proposes an `enforceGlobalLaneCap` function to reduce total lanes across repos when they exceed `maxLanes`. The approach is sound, the test scenario targets the right behavior, and the checkboxes represent meaningful outcomes.

### Issues Found
None critical or blocking.

### Missing Items
None — the PROMPT's "Preserve at least 1 lane per repo with tasks" constraint is implicit in the `enforceGlobalLaneCap` function description ("reduces lanes across repos when total exceeds maxLanes" + "repos with most headroom" naturally preserves minimum 1). The worker will need to handle this in implementation.

### Suggestions
- **Edge case to consider in implementation:** When `maxLanes < number of repos with tasks`, the "at least 1 lane per repo" guarantee becomes impossible. The implementation should either document this as a config validation warning or allow the min-1 guarantee to override maxLanes in this edge case (i.e., total lanes = number of repos). This is an implementation detail the worker can resolve.
- `computeWaveAssignments()` (used by `/orch-plan` preview) does not do repo grouping and thus doesn't have this same over-allocation bug. The lane counts shown in preview vs. actual execution may already differ — no action needed for this step, but worth noting for awareness.
- Consider adding a second test for the "reduce repos with most headroom" behavior (e.g., repo A has 3 tasks, repo B has 1 task → repo A should keep more lanes). Not blocking — the primary test covers the critical invariant.
