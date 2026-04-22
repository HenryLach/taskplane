## Plan Review: Step 3 — Fix session naming mismatch

### Verdict: APPROVE

### Summary
The plan correctly identifies the root cause: in workspace mode, `laneSessionId` includes the repoId (e.g., `"orch-henrylach-api-service-lane-1"`) while the V2 agent registry keys are built from `agentIdPrefix` which omits the repoId (e.g., `"orch-henrylach-lane-1-worker"`). The approach of fixing `isV2AgentAlive` and adding an `agentId` field to `AllocatedLane` is sound and aligns with the PROMPT.md constraint "fix the lookup, not the IDs."

### Issues Found
None blocking.

### Missing Items
None — the three checkboxes cover the necessary outcomes.

### Suggestions
- **Backward compatibility for persistence**: Adding `agentId` to `AllocatedLane` will likely also require it as an optional field on `PersistedLaneRecord` (types.ts:2789) so it survives across save/resume. The resume path (`resume.ts:143-160`) reconstructs `AllocatedLane` from `PersistedLaneRecord`, so it needs to forward the field. Old state files won't have it — ensure a sensible derivation fallback (e.g., derive from `laneSessionId` by stripping repoId and appending `-worker`, or fall back to the existing `isV2AgentAlive` fallback logic).

- **Dashboard may already work**: The dashboard's `isLaneAliveV2()` (`app.js:62-68`) looks up agents by `laneNumber` rather than by session name, so it may not suffer from this mismatch. The worker should verify before making dashboard changes — if no fix is needed there, skip it rather than adding unnecessary code.

- **execution.ts monitor is also a consumer**: The monitor loop at `execution.ts:1252` calls `isV2AgentAlive(laneSessionIdOf(lane), "v2")` — the first checkbox ("Fix isV2AgentAlive to handle workspace-mode lane session IDs") should cover this if the function itself is made smarter. If the approach is instead to only fix callers, make sure the monitor call is updated too, not just formatting.ts.
