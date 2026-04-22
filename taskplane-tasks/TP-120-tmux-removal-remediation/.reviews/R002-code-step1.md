## Code Review: Step 1: Remove TMUX helper functions from execution.ts

### Verdict: REVISE

### Summary
The TMUX helper removals in `execution.ts` are mostly complete and the direct helper callsites there were replaced with V2-oriented logic as planned. However, the required import-site update in `merge.ts` introduced a blocking liveness regression: `MergeHealthMonitor.poll()` now calls `isV2AgentAlive()` without seeding the registry cache that function depends on. This can misclassify live sessions as dead and produce incorrect health/dead-session signaling.

### Issues Found
1. **[extensions/taskplane/merge.ts:2810] [important]** — `MergeHealthMonitor.poll()` now uses `isV2AgentAlive(sessionName, "v2")`, but no registry snapshot is loaded into execution’s liveness cache in this code path. Per `execution.ts` (`isV2AgentAlive` at line 237), missing cache returns `false` immediately. If/when sessions are monitored, they can be falsely marked dead. **Fix:** In `poll()`, refresh the cache first (e.g., `setV2LivenessRegistryCache(readRegistrySnapshot(this.stateRoot, this.batchId))` before iterating, and clear afterward), or switch to a direct non-cached registry lookup local to merge monitor.
2. **[extensions/tests/supervisor-merge-monitoring.test.ts:503] [important]** — Current Step 1 diff leaves an existing test failing (`8.1` source assertion expects `tmuxHasSessionAsync(sessionName)` in `poll()`). This is currently red when running `node --test tests/supervisor-merge-monitoring.test.ts`. **Fix:** Update the test expectation once the V2 liveness path is correctly wired (including cache initialization), not just the symbol rename.

### Pattern Violations
- None beyond the liveness-cache integration miss above.

### Test Gaps
- No behavioral test currently validates that merge monitor V2 liveness checks preload registry data before evaluating session health.

### Suggestions
- After fixing the merge monitor liveness wiring, add a focused unit test that simulates cached/uncached registry states to prevent future false-dead regressions.
- Minor cleanup: comments in `execution.ts` around monitor precedence still reference TMUX session semantics; consider updating wording in a follow-up for clarity.
