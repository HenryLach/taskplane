## Code Review: Step 2: Default Merge Failure to Paused

### Verdict: REVISE

### Summary
The phase transition change to `paused` is applied consistently in both `engine.ts` and `resume.ts`, and the intent to reserve `failed` for unrecoverable invariants is clearly documented. However, the new `preserveWorktreesForResume = true` assignment is made after terminal cleanup has already run, so in key failure paths the worktrees are still deleted before the batch is marked `paused`. That ordering breaks the stated resumability/preservation intent and needs to be fixed before approval.

### Issues Found
1. **[extensions/taskplane/engine.ts:824-1001] [important]** — `preserveWorktreesForResume` is set too late to affect cleanup.
   - Cleanup is gated at `engine.ts:824` (`if (preserveWorktreesForResume) ... else cleanup`) but the new assignment for failed-task finalization happens later at `engine.ts:995-1001`.
   - In paths where `failedTasks > 0` and no earlier merge/cleanup-gate pause occurred, cleanup already removed worktrees/branches before phase becomes `paused`.
   - **Fix:** determine resumable final state (or a `shouldPreserveForResume` flag) before Phase 3 cleanup, and use that precomputed value to gate cleanup.

2. **[extensions/taskplane/resume.ts:1665-1750] [important]** — Same ordering bug in resume parity path.
   - Resume cleanup runs under `if (!preserveWorktreesForResume)` at `resume.ts:1665-1739`, but the new `failedTasks > 0 => paused` and `preserveWorktreesForResume = true` is only applied at `resume.ts:1744-1750`.
   - This causes resumed batches to delete worktrees before marking the state as resumable.
   - **Fix:** mirror the engine fix: compute preservation intent before section 11 cleanup and keep engine/resume ordering identical.

### Pattern Violations
- Behavior change affecting resume recoverability was made without preserving pre-cleanup decision ordering (engine/resume lifecycle parity expectation is broken at cleanup timing).

### Test Gaps
- Missing regression test for the `failedTasks > 0` terminal path where no prior `preserveWorktreesForResume` flag is set (e.g., all tasks fail, merge skipped): should end `paused` **and** skip cleanup.
- Missing parity test that asserts the same preservation behavior in `resumeOrchBatch()`.
- No test asserting `on_merge_failure: abort` remains `stopped` with existing cleanup behavior unchanged.

### Suggestions
- Add a small shared helper (or mirrored pre-cleanup block) that computes `finalPhaseIntent` + `preserveWorktreesIntent` before cleanup to prevent future drift.
- Keep comments aligned with behavior by explicitly documenting that preservation decisions are made pre-cleanup.
