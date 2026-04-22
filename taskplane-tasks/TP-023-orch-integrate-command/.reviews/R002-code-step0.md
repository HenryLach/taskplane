## Code Review: Step 0: Preflight

### Verdict: REVISE

### Summary
Step 0 captures several useful discoveries, but it does not resolve the critical preflight risk raised in R001: `/orch-integrate` may have no state file to read after clean completion. The status artifact also has structural inconsistencies (duplicate/malformed review/log rows), and test-impact mapping remains too broad for execution. Please address these before proceeding to Step 1.

### Issues Found
1. **[taskplane-tasks/TP-023-orch-integrate-command/STATUS.md:14,84-90] [critical]** — Step 0 is marked complete, but the preflight still omits the state-lifetime contract required by R001. Current runtime deletes `.pi/batch-state.json` on clean completion (`extensions/taskplane/engine.ts:824-828`, `extensions/taskplane/resume.ts:1468-1471`), so `/orch-integrate` can be blocked with no persisted metadata. **Fix:** add an explicit discovery + implementation decision for the "state file missing after successful batch" path, and keep Step 0 open until this contract is captured.
2. **[taskplane-tasks/TP-023-orch-integrate-command/STATUS.md:89] [important]** — Test impact is still recorded as `extensions/tests/` (directory-level), not concrete files, despite R001 requesting concrete test-surface mapping. **Fix:** identify specific test files to extend (for command registration/parsing, workspace root handling, and branch-safety behavior).
3. **[taskplane-tasks/TP-023-orch-integrate-command/STATUS.md:73-76,99-104] [important]** — Status bookkeeping is malformed/inconsistent: reviews table header separator is in the wrong place, review rows are duplicated, and execution log entries are duplicated. **Fix:** normalize table structure to project pattern (`header -> separator -> rows`) and deduplicate repeated events.
4. **[taskplane-tasks/TP-022-orch-branch-lifecycle-merge-redirect/.DONE:1-2] [minor]** — This TP-023 Step 0 commit also edits TP-022 completion artifacts, which is unrelated scope for this step. **Fix:** keep task-step commits scoped to the active task folder unless cross-task maintenance is explicitly required.

### Pattern Violations
- STATUS review table format deviates from existing task pattern (see TP-022 STATUS reviews section for canonical ordering).
- Duplicate review/log rows reduce audit clarity and can mislead automation consuming task status.

### Test Gaps
- No explicit planned validation for `/orch-integrate` behavior when `loadBatchState()` returns `null` because state was deleted after clean completion.
- No concrete test file mapping yet for command registration/arg parsing and branch safety checks.

### Suggestions
- Add one preflight discovery entry covering `--merge` + `--pr` conflict handling so Step 1 parsing behavior is deterministic.
