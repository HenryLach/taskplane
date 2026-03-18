## Code Review: Step 3: Update All Callers

### Verdict: APPROVE

### Summary
The Step 3 caller updates are correctly applied across runtime paths: batch-scoped `listWorktrees()` usage in reset/reuse flows, batch-scoped `removeAllWorktrees()` usage in cleanup/rollback flows, and merge worktree path construction now delegated to the shared config-aware helper. I verified the changed callsites in `engine.ts`, `resume.ts`, `waves.ts`, `worktree.ts`, and `merge.ts`, and confirmed there are no remaining opId-only list/remove calls in active batch flows. Full test suite validation also passes.

### Issues Found
1. **None** [minor] — No blocking issues identified in this step.

### Pattern Violations
- None observed.

### Test Gaps
- No blocking gaps for this step.
- Optional follow-up: add an explicit integration assertion around legacy flat-layout transition behavior when batch-scoped callers pass `batchId` (for long-lived pre-migration resume/cleanup scenarios).

### Suggestions
- Consider adding a focused regression test that exercises concurrent same-operator batches end-to-end through engine/resume cleanup, to lock in the new batch isolation guarantees at caller level.
- Validation run: `cd extensions && npx vitest run` (21 files, 742 tests passing).
