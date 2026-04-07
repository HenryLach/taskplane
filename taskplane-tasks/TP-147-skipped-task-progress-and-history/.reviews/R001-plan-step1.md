## Plan Review: Step 1 — Preserve skipped task branches

### Verdict: APPROVE

### Summary
The plan for Step 1 correctly identifies the two key changes needed: (1) extending the safety-net auto-commit to cover skipped-task lanes, and (2) saving those branches instead of deleting them. The approach aligns well with the PROMPT's recommended Option B+C. The scope is focused on `engine.ts` which is the right file since that's where both the safety-net and the branch cleanup logic live.

### Issues Found
None critical.

### Missing Items
None — the plan covers the essential outcomes:
- Safety-net auto-commit extended to skipped lanes
- Branch saved as `saved/{opId}-{taskId}-{batchId}` instead of deleted
- Operator visibility via logging
- Skipped lanes NOT merged (important constraint preserved)

### Suggestions
- **Minor — `preserveFailedLaneProgress` scope:** The existing `preserveFailedLaneProgress()` in `worktree.ts` already implements the `saved/{opId}-{taskId}-{batchId}` branch saving pattern but only for `failed` and `stalled` tasks. The worker could consider either: (a) extending the filter in `preserveFailedLaneProgress` to also include `skipped` status (cleanest reuse of existing save-branch logic), or (b) adding parallel logic in `engine.ts` specifically for skipped tasks. Either approach works — Option (a) would be more DRY but the worker has the context to decide.
- **Minor — safety-net condition:** The current safety-net condition is `hasSucceeded` — for skipped lanes, the lane may have a mix of statuses (e.g., one task succeeded, another got skipped via stop-wave). The worker should ensure the safety-net fires for lanes that have *any* skipped task with an existing worktree, even if no task on that lane succeeded. The `hasSucceeded` guard should be loosened to also include `hasSkipped`.
- **Minor — naming convention consistency:** The plan says `saved/{opId}-{taskId}-{batchId}` which matches `computePartialProgressBranchName()` in `worktree.ts`. Good — this ensures consistency with the existing pattern and the `deleteStaleBranches()` cleanup logic will handle these branches correctly.
