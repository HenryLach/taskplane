## Code Review: Step 1: Create Orch Branch at Batch Start

### Verdict: REVISE

### Summary
The core Step 1 behavior is implemented correctly for the happy path: the orch branch name follows the required contract, creation uses `runGit()`, failure is surfaced clearly, and `batchState.orchBranch` is set/logged. However, the branch is created too early in the planning flow, and multiple existing early returns now bypass cleanup and leak `orch/*` branches. This should be fixed before moving on because it breaks branch lifecycle hygiene on common failure/no-op paths.

### Issues Found
1. **[extensions/taskplane/engine.ts:75-89,112-117,133-165,174-191] [important]** — `orch/{opId}-{batchId}` is created before preflight/discovery/graph checks, but those checks still `return` early. As a result, preflight failures, fatal discovery errors, "no pending tasks", graph validation failures, and wave computation failures leave a stray orch branch behind (no Phase 3 cleanup runs on these paths). **Fix:** either (a) defer branch creation until after planning gates pass (right before Phase 2 starts), or (b) add best-effort orch-branch cleanup on every planning-phase early return after creation.

### Pattern Violations
- None beyond the lifecycle leak above.

### Test Gaps
- No regression test asserts that planning-phase early exits (especially preflight failure and `discovery.pending.size === 0`) do **not** leave an `orch/*` branch behind.
- No test covers branch-creation collision behavior (`git branch` failure) end-to-end in `executeOrchBatch`.

### Suggestions
- If you keep creation early for architectural reasons, centralize planning failure exits into a helper that both sets failure state and performs best-effort orch-branch cleanup to avoid duplicated return-path logic.
