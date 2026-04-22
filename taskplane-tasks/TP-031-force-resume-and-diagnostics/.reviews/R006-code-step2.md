## Code Review: Step 2: Default Merge Failure to Paused

### Verdict: REVISE

### Summary
The phase transition edits in `engine.ts` and `resume.ts` move `failedTasks > 0` to `paused`, but the worktree-preservation intent is not actually enforced because cleanup already runs before that phase decision. This creates a mismatch between state (`paused`/resumable) and artifacts on disk (worktrees already cleaned), and can leave operators without a clear final message for this new paused path. The changes need a small control-flow adjustment in both files before this is safe.

### Issues Found
1. **[extensions/taskplane/engine.ts:824, 995-1000] [important]** — `preserveWorktreesForResume` is set too late to affect cleanup.
   - Cleanup is gated at line 824, but `preserveWorktreesForResume = true` for `failedTasks > 0` is only set at lines 995-1000.
   - Result: worktrees/sidecars are already removed before the batch is marked `paused`.
   - **Fix:** compute the final resumable outcome (or a `shouldPreserveForResume` flag) before entering Phase 3 cleanup, then use that flag to gate cleanup.

2. **[extensions/taskplane/resume.ts:1665, 1702, 1745-1750] [important]** — Same ordering bug in resume flow (engine/resume parity regression).
   - Resume cleanup runs under `!preserveWorktreesForResume` at lines 1665/1702, but the new pause-preserve assignment is only at 1745-1750.
   - Result: resumed batches can also end as `paused` after cleanup already removed resumable artifacts.
   - **Fix:** mirror the engine fix: decide/derive preservation before section 11 cleanup and keep both paths structurally identical.

3. **[extensions/taskplane/engine.ts:1036-1055, extensions/taskplane/resume.ts:1784-1797] [minor]** — New `failedTasks > 0 => paused` path has no explicit operator-facing final notification.
   - `paused/stopped` paths suppress completion banners, and this new paused outcome does not emit a dedicated pause reason.
   - **Fix:** emit an explicit pause summary (`why paused`, `what to do next`) when this finalization branch is taken.

### Pattern Violations
- Engine/resume parity intent is documented in comments, but current control-flow ordering diverges from the intended preservation semantics in both files.

### Test Gaps
- Missing regression tests for cleanup ordering:
  - when final phase becomes `paused` due `failedTasks > 0`, worktrees must be preserved (not cleaned)
  - same assertion for `resumeOrchBatch()` finalization path
- Missing assertion for operator message on this new paused-finalization branch.

### Suggestions
- Add one shared helper for “final outcome decision” (phase + preserve flag) to avoid future engine/resume drift.
