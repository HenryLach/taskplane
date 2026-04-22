## Code Review: Step 3: Remove dead TMUX helpers

### Verdict: REVISE

### Summary
The TMUX helper removals are mostly complete and tests pass, but the new Runtime V2 cleanup path in `engine.ts` is currently ineffective in key cases. In particular, lingering-agent cleanup now depends on lane state and a monitor-only cache, so the intended pre-worktree kill step can no-op even when processes are still alive. This is a correctness issue for cleanup/lock-release behavior and should be fixed before approving Step 3.

### Issues Found
1. **[extensions/taskplane/engine.ts:2480, extensions/taskplane/sessions.ts:25, extensions/taskplane/engine.ts:1313] [important]** — Final cleanup now discovers "lingering sessions" only from `batchState.currentLanes`, but `currentLanes` is explicitly cleared after each wave (`engine.ts:1313`). In normal completion paths this makes `listOrchSessions(...)` return empty at cleanup time, so no lingering-process kill is attempted. **Fix:** derive lingering Runtime V2 agents from registry/active handles (or persisted runtime manifests), not `currentLanes` only.

2. **[extensions/taskplane/engine.ts:2485, extensions/taskplane/execution.ts:266, extensions/taskplane/execution.ts:1578/1581/1734/1756] [important]** — `engine.ts` now calls `killV2LaneAgents(baseSessionName)`, but that helper hard-depends on `_v2LivenessRegistryCache`; when cache is null it returns immediately (`execution.ts:266`). That cache is populated only during monitor polling and then reset to null (`execution.ts:1578, 1581, 1734, 1756`), so cleanup-time kills can silently no-op. **Fix:** add a cleanup-safe kill function that reads a fresh registry snapshot directly (no monitor cache dependency), and use that from engine/abort cleanup.

3. **[extensions/taskplane/engine.ts:2486, extensions/taskplane/sessions.ts:28, extensions/taskplane/merge.ts:1383] [important]** — `killMergeAgentV2(baseSessionName)` is called with lane session IDs from `listOrchSessions` (`lane.laneSessionId`), but merge agents are keyed by merge session names (`${prefix}-${opId}-merge-${laneNumber}`), so this call will not match active merge handles. **Fix:** either call `killAllMergeAgentsV2()` during final cleanup, or track and pass actual merge session IDs.

### Pattern Violations
- None beyond the cleanup-path correctness issues above.

### Test Gaps
- No regression test verifies that final cleanup still kills Runtime V2 agents when `currentLanes` has already been cleared.
- No test verifies merge-agent cleanup uses actual merge session IDs (or a bulk-kill fallback) in final cleanup.

### Suggestions
- After fixing cleanup targeting, add a focused test around the Phase 3 cleanup block in `engine.ts` to lock in non-TMUX lingering-process behavior on Windows lock scenarios.
