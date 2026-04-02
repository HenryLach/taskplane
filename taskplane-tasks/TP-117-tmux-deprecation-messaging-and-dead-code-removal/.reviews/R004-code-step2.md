## Code Review: Step 2: Remove dead execution functions

### Verdict: APPROVE

### Summary
Step 2 achieves the stated outcomes: legacy `executeLane()`, `spawnLaneSession()`, `buildTmuxSpawnArgs()`, and legacy `spawnMergeAgent()` were removed, and call sites/imports in `engine.ts`, `merge.ts`, `resume.ts`, and `extension.ts` were updated accordingly. Runtime execution now routes through `executeLaneV2`/`spawnMergeAgentV2` consistently in the touched paths. I did not find blocking correctness issues for this step’s scope.

### Issues Found
1. **[extensions/taskplane/execution.ts:1978-1984] [minor]** — The `executeWave()` docblock still describes TMUX-session behavior (`stop-all` killing TMUX sessions and `executeLane()` polling), which is now stale after legacy executor removal. Suggested fix: update comments to describe Runtime V2 agent-host behavior to avoid operator/developer confusion.

### Pattern Violations
- None blocking.

### Test Gaps
- Full suite is not yet green at this checkpoint (`supervisor-merge-monitoring.test.ts` still expects merge health-monitor session registration behavior removed in this step). This appears aligned with planned Step 4 test reconciliation, but should be resolved before final task completion.
- Several structural tests still reference removed legacy symbols (`spawnLaneSession`, `buildTmuxSpawnArgs`, legacy `spawnMergeAgent`) and should be updated/retired in Step 4.

### Suggestions
- In `merge.ts`, adjust retry-loop comments around `healthMonitor.removeSession()` (e.g., “will re-register on respawn”) since V2 path no longer registers TMUX sessions.
- After Step 3/4, run full `extensions/tests/*.test.ts` and clean up stale legacy-branch assertions in one pass for consistency.
