## Code Review: Step 2: Implement Integration Logic

### Verdict: REVISE

### Summary
The new state→arg→branch-scan resolution flow is solid, and the detached-HEAD plus branch-safety checks are wired in correctly. However, there is one blocking correctness gap: the command does not enforce that loaded persisted state is in `completed` phase before proceeding. That allows `/orch-integrate` to continue from an in-progress batch, which violates the step requirements and risks premature integration.

### Issues Found
1. **[extensions/taskplane/extension.ts:757-773] [critical]** — Missing persisted-state phase gate. After `loadBatchState(repoRoot)` succeeds, the handler reads `orchBranch/baseBranch/batchId` but never checks `state.phase`. If phase is `planning`/`executing`/`merging`/`paused`, the command should stop and tell the user to wait or use `/orch-status`.
   - **Fix:** Add `if (state.phase !== "completed") { ... return; }` immediately after entering the `if (state)` block, before legacy `orchBranch === ""` handling.
2. **[taskplane-tasks/TP-023-orch-integrate-command/STATUS.md:87-88] [minor]** — Reviews table contains duplicate `R005` row.
   - **Fix:** Remove the duplicate row to keep task metadata clean.

### Pattern Violations
- Behavior-heavy command logic was added in `extensions/taskplane/extension.ts` without corresponding handler-level tests for the new decision branches.

### Test Gaps
- No tests for phase gating (`completed` vs non-completed persisted phases).
- No tests for new fallback branches:
  - state missing + no arg + 0/1/many `orch/*` branches
  - `StateFileError` (IO/parse/schema) with and without explicit branch arg
- No tests for detached HEAD handling in `/orch-integrate` handler path.

### Suggestions
- Consider extracting context resolution/safety logic into a pure helper (e.g. `resolveIntegrationContext`) to make these branches easy to unit test.
- Remove unused local `stateAvailable` if it is not needed.
