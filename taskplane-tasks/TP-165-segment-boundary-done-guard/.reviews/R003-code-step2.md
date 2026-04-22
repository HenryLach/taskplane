## Code Review: Step 2: Fix Segment Expansion Consumption

### Verdict: REVISE

### Summary
The change correctly addresses the repo-mode fallback bug by ensuring a `-worker` suffix is added when `outcome.sessionName` is missing. However, the fallback is still not canonical in workspace mode because it derives from `laneSessionId`, while runtime worker IDs are generated from `laneNumber` + runtime prefix. That means boundary expansion consumption can still fail on the fallback path in polyrepo/workspace runs.

### Issues Found
1. **[extensions/taskplane/engine.ts:166] [important]** — Fallback agent ID derivation is still incorrect for workspace lanes. `laneSessionId` is repo-scoped/local-lane (e.g., `orch-op-api-lane-1` from `waves.ts:508-512`), but worker IDs are generated as `buildRuntimeAgentId(agentIdPrefix, lane.laneNumber, "worker")` (e.g., `orch-op-lane-2-worker` in `execution.ts:2457`). Appending `-worker` to `laneSessionId` can target a non-existent outbox, so expansion requests remain unconsumed when fallback is used. **Suggested fix:** derive fallback via the same canonical runtime-ID builder path (or persist a canonical workerAgentId on lane records and consume that), then add coverage for workspace lane naming.

### Pattern Violations
- None.

### Test Gaps
- Missing workspace-mode regression for fallback resolution (repo-scoped `laneSessionId` + global `laneNumber` mismatch).
- No behavior-level boundary consumption test proving the fallback path finds `.../<workerAgentId>/outbox` and renames request files to `.processed`.

### Suggestions
- Keep `resolveTaskWorkerAgentId` exported only if intended for direct unit testing; otherwise consider testing through a public behavior seam.
