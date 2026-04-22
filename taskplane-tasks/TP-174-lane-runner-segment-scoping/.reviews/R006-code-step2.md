## Code Review: Step 2: Segment-Scoped Progress and Stall Detection

### Verdict: REVISE

### Summary
The main Step 2 changes are in place: pre/post progress delta is segment-scoped, stall counting uses that delta, and unchecked-item extraction for intercept messaging is segment-aware. However, the exit-intercept progress gate now compares different scopes (global vs segment), which can incorrectly treat a no-progress exit as progress and bypass the corrective path. This is a functional regression and should be fixed before proceeding.

### Issues Found
1. **[extensions/taskplane/lane-runner.ts:571-573] [important]** `onPrematureExit` still computes `midTotalChecked` from **all** task checkboxes, but `prevTotalChecked` is now segment-scoped (set at lines 373-380). In segment-scoped runs, this makes `midTotalChecked > prevTotalChecked` true even when the current segment made zero progress (because other segments/earlier steps already have checked boxes), so the intercept returns early and skips corrective handling.  
   **Fix:** In `onPrematureExit`, compute the mid-iteration checked count using the same scope as `prevTotalChecked` (segment-scoped via `getSegmentCheckboxes(statusContent, firstStep.number, currentRepoId)` when segment mode is active; global fallback otherwise).

### Pattern Violations
- None.

### Test Gaps
- Missing behavior test that exercises `onPrematureExit` in segment-scoped mode where global checked count is already higher than current-segment checked count, and verifies no-progress exits still trigger intercept/escalation logic.
- Missing regression test that confirms scope parity (pre/mid/post checked counts all use segment scope when segment filtering is active).

### Suggestions
- Consider extracting a small helper for “checked count for current execution scope” (segment or global) and reusing it in pre-check, mid-check (`onPrematureExit`), and post-check to prevent future scope drift.
