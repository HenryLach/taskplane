## Code Review: Step 1: Create Orch Branch at Batch Start

### Verdict: REVISE

### Summary
The implementation correctly adds `orch/{opId}-{batchId}` creation, stores it in `batchState.orchBranch`, and fails fast on branch-creation errors with a clear notify path. However, creating the orch branch this early introduces a new lifecycle leak: multiple planning-phase early returns now leave orphan `orch/*` branches behind. The step also ships without automated coverage for the new branch-creation behavior.

### Issues Found
1. **[extensions/taskplane/engine.ts:75-165] [important]** — `orchBranch` is created before preflight/discovery, but early returns (`preflight` fail, fatal discovery errors, and `no pending tasks`) exit before Phase 3 cleanup. This leaves orphan orch branches with no execution and (for many of these paths) no persisted state to aid cleanup. **Fix:** either (a) move branch creation until after preflight/discovery confirm execution will proceed, or (b) add best-effort branch cleanup on all planning-phase exits that occur after branch creation.
2. **[extensions/taskplane/engine.ts:75-89] [important]** — Behavior changed but no tests were added/updated in `extensions/tests/*` for this step. **Fix:** add coverage for at least: successful branch creation (`runGit branch` called with `orch/{opId}-{batchId}`), branch-creation failure path (phase/error/notify/return), and planning early-exit behavior so branch lifecycle is explicit and regression-safe.

### Pattern Violations
- Project standard (`AGENTS.md`): “Add or update tests for behavior changes.” No test changes were included for Step 1.

### Test Gaps
- Success path: orch branch name generation + persisted in runtime state.
- Failure path: branch already exists / git branch failure sets failed phase and user-facing error.
- Lifecycle path: preflight/discovery/no-op exits after branch creation do not leak stale branches (or are intentionally documented/tested if preserved).

### Suggestions
- When reporting branch-creation failures, consider falling back to `stdout` if `stderr` is empty so the notify message is never blank.
