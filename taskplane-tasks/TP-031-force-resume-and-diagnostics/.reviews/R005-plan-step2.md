## Plan Review: Step 2: Default Merge Failure to Paused

### Verdict: REVISE

### Summary
The plan is close and now covers engine/resume parity, but it still misses a key execution-order risk that can break resumability. Specifically, setting `preserveWorktreesForResume = true` in the end-of-batch finalizer is too late if cleanup has already run. The plan also needs to explicitly clarify whether this step intentionally broadens from “merge failure” to “any failedTasks”.

### Issues Found
1. **[Severity: important]** — Cleanup/preservation ordering is not addressed, so the proposed preservation behavior may not actually happen.
   - Evidence: `STATUS.md:40-41` plans to set `preserveWorktreesForResume = true` in end-of-batch finalization. But cleanup is gated earlier in both flows (`extensions/taskplane/engine.ts:824-984`, `extensions/taskplane/resume.ts:1665-1739`) before final phase assignment (`engine.ts:993-1001`, `resume.ts:1744-1750`).
   - Suggested fix: add an explicit plan item to compute resumable-final-state (or at least a `shouldPreserveForResume` flag) **before** cleanup gates execute.

2. **[Severity: important]** — Scope drift is not explicitly justified: current plan changes all `failedTasks > 0` outcomes, not only merge-failure outcomes.
   - Evidence: `STATUS.md:40` defines `failedTasks > 0 -> "paused"` when phase is executing/merging.
   - Risk: this may intentionally or unintentionally broaden behavior beyond “default merge failure to paused” from the step objective.
   - Suggested fix: state explicit intent in the plan (“merge-only” vs “all failed task outcomes”) and align tests/docs to that declared contract.

3. **[Severity: minor]** — Step-specific test intent is still too broad for the highest-risk branch.
   - Evidence: Step 2 lists validation intent (`STATUS.md:43`) but no concrete scenarios for preservation timing or resume parity; Step 4 has only generic merge-phase checks (`STATUS.md:61`).
   - Suggested fix: add concrete test intent for (a) paused outcome preserves worktrees/branches, (b) same behavior in resume path, and (c) `on_merge_failure: abort` still ends `stopped`.

### Missing Items
- Explicit pre-cleanup decision point for resume-preservation semantics.
- Explicit statement of whether Step 2 is merge-only or all-failure pause behavior.
- Concrete Step 2 tests for worktree preservation and engine/resume parity.

### Suggestions
- Add one short “phase decision timing” note to STATUS so later Step 4 tests can validate the exact intended lifecycle.
- Reuse `computeMergeFailurePolicy()` semantics as the source of truth when documenting merge-specific behavior boundaries.
