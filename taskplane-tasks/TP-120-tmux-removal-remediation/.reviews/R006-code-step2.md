## Code Review: Step 2: Remove merge health monitor TMUX polling

### Verdict: APPROVE

### Summary
The Step 2 implementation removes the merge monitor’s remaining functional TMUX polling/capture paths in `extensions/taskplane/merge.ts` and switches health classification to V2 liveness + result-file/time-based semantics. The related test suite (`extensions/tests/supervisor-merge-monitoring.test.ts`) was updated to match the new contract and verify TMUX capture helpers/commands are no longer present. Targeted merge-monitor tests pass with these changes.

### Issues Found
1. **None blocking.**

### Pattern Violations
- None identified.

### Test Gaps
- Consider adding one direct behavior test for the `sessionAlive=true && hasResultFile=true` branch to lock in intended classification semantics during completion races.

### Suggestions
- Follow-up cleanup (non-blocking): `MergeSessionSnapshot`/`MERGE_HEALTH_CAPTURE_LINES` docs and related comments in `types.ts` still describe pane-capture semantics; updating/removing those stale references would better reflect the de-TMUXed monitor design.
