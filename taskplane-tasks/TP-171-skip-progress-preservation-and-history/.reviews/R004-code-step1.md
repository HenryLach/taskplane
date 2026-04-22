## Code Review: Step 1: Preserve Skipped Task Progress

### Verdict: REVISE

### Summary
This revision resolves the earlier R002/R003 structural issues (isolated worktree staging, workspace lane-outcome wiring, and skipped-only repo handling), and targeted merge tests still pass. However, two blocking correctness gaps remain: skipped-artifact staging currently includes `.DONE` from non-mergeable lanes, and workspace safe-stop semantics can still be violated by post-loop skipped-only staging. Both can produce incorrect persisted state and should be fixed before approving Step 1.

### Issues Found
1. **[extensions/taskplane/merge.ts:1468-1474, 2060, 2094-2119, 2469-2477] [critical]** Non-mergeable lanes are selected for artifact staging when they contain **any** skipped task, but artifact allowlist includes `.DONE` and applies to **all tasks in those lanes**. In mixed lanes (e.g., succeeded + failed + skipped), this can copy `.DONE` for succeeded tasks whose code commits were intentionally not merged, causing false completion markers on the orch branch. **Fix:** for non-mergeable/skipped-artifact paths, stage only skipped-task artifacts (at minimum `STATUS.md`/`.reviews`/`REVIEW_VERDICT.json`) and do not stage `.DONE` unless the task’s code was actually merged.
2. **[extensions/taskplane/merge.ts:2632-2644, 2647-2663] [important]** `mergeWaveByRepo()` correctly safe-stops repo merging on rollback failure, but still runs skipped-only repo artifact staging afterward, which can advance refs in additional repos despite safe-stop intent. This contradicts the recovery model and can complicate rollback handling. **Fix:** gate the post-loop skipped-only staging behind `!anyRollbackFailed` (or return immediately after safe-stop).

### Pattern Violations
- Safe-stop recoverability contract is weakened by continuing ref-changing operations after rollback failure (workspace repo mode).

### Test Gaps
- Missing regression for mixed-outcome non-mergeable lane (succeeded+failed+skipped) asserting `.DONE` is **not** staged for tasks whose commits were not merged.
- Missing regression for workspace safe-stop path ensuring no skipped-only repo artifact commit occurs after `anyRollbackFailed` is set.

### Suggestions
- Consider splitting artifact allowlists by lane class: merged lanes (`.DONE`, `STATUS.md`, review files) vs skipped-only preservation lanes (`STATUS.md`, review files only).
