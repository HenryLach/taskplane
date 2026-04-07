## Code Review: Step 3 — Fix session naming mismatch

### Verdict: APPROVE

### Summary
The implementation correctly addresses the root cause of the "session dead" false positive in workspace mode. The approach adds a `laneNumber`-based fallback scan to both `isV2AgentAlive` and `killV2LaneAgents`, activated when the session-name-based lookup fails (as it does in workspace mode where `laneSessionId` includes repoId but registry keys use global lane numbers without repoId). All four call sites in `execution.ts` are updated to pass the global `laneNumber`. The `killedPids` Set added to `killV2LaneAgents` is a welcome defensive improvement to prevent double-kill attempts. Tests pass (104/104).

### Issues Found
None blocking.

### Pattern Violations
None. The changes follow the existing function signature extension pattern (optional trailing parameters with `null` check), maintain backward compatibility, and include clear TP-148 comments explaining the workspace-mode mismatch.

### Test Gaps
- There are no direct unit tests for the `isV2AgentAlive` laneNumber fallback or the `killV2LaneAgents` laneNumber fallback. The existing tests at `engine-runtime-v2-routing.test.ts:530-598` are source-structure tests (checking that function bodies contain certain strings), not behavioral tests. However, these functions depend on process liveness checks (`isProcessAlive`) and the global `_v2LivenessRegistryCache`, which makes them difficult to unit test without significant mocking infrastructure. The structural tests still pass and verify the integration points. This is acceptable given the testing constraints.

### Suggestions
- **abort.ts:290** — `killOrchSessions` calls `killV2LaneAgents` without passing `laneNumber`, meaning the abort path may also fail to kill agents in workspace mode due to the same naming mismatch. The abort flow discovers session names from `lane.laneSessionId` (which includes repoId), but doesn't forward `laneNumber`. This is a secondary concern (abort is a cleanup path, not the display/monitoring issue described in #425), but worth addressing in a follow-up if workspace-mode abort reliability matters. Not blocking for this step.

- **merge.ts:2721** — `isV2AgentAlive(sessionName, "v2")` in merge session polling doesn't pass `laneNumber`, but this is correct since merge agents have their own naming convention that doesn't suffer from the lane/repo mismatch. No action needed.

- In `isV2AgentAlive`, the fallback scans only for `role === "worker"`. This is semantically correct (the lane is "alive" when its worker is alive), but worth a brief JSDoc note on the `laneNumber` parameter explaining this design choice, since callers might expect it to also match reviewer agents.
