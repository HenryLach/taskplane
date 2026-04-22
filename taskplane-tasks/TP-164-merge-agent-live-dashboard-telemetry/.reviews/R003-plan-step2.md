## Plan Review: Step 2: Write snapshots from spawnMergeAgentV2

### Verdict: REVISE

### Summary
The step is well-targeted and aligns with the intended architecture: emit merge snapshots from `spawnMergeAgentV2` using the Runtime V2 telemetry callback pattern introduced in Step 1. However, there is one important correctness gap in the terminal snapshot plan that can cause failed merge agents to be misclassified. Addressing that status-mapping detail will make this step safe to implement.

### Issues Found
1. **[Severity: important]** — The plan says to write terminal `complete`/`failed` snapshots in `.then/.catch`, but `spawnAgent(...).promise` resolves on both successful and failed process exits (non-zero exit, killed, timed out) and only rarely rejects. If failure is only handled in `.catch`, failed agents may never get a `failed` terminal snapshot. **Fix:** in `.then(result)`, derive terminal snapshot status from `AgentHostResult` (e.g., `killed || exitCode !== 0 || !agentEnded => "failed"`, otherwise `"complete"`), and keep `.catch` only as exceptional fallback.

### Missing Items
- Explicit terminal status mapping rules based on `AgentHostResult` fields (`exitCode`, `killed`, `agentEnded`) should be part of the step plan.

### Suggestions
- Consider writing an initial `running` snapshot immediately after spawn (before first telemetry callback) so the merge row can show up with deterministic snapshot presence even when telemetry events are delayed.
- Prefer passing `waveIndex` into `spawnMergeAgentV2` (or otherwise sourcing it) instead of hardcoding `0`, so snapshot metadata remains accurate for future dashboard features.
