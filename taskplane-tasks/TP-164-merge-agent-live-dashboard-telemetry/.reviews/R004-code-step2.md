## Code Review: Step 2: Write snapshots from spawnMergeAgentV2

### Verdict: APPROVE

### Summary
Step 2 implementation in `extensions/taskplane/merge.ts` correctly adds live merge snapshot emission via the `spawnAgent` telemetry callback, writes an initial `running` snapshot, and writes terminal `complete`/`failed` snapshots on agent completion. This also addresses the key plan-review risk from R003 by deriving terminal status in `.then(result)` instead of relying on `.catch`. I found no blocking correctness issues for this step’s stated outcomes.

### Issues Found
1. **None (blocking)** — No critical/important defects found in the Step 2 code path.

### Pattern Violations
- None identified.

### Test Gaps
- No targeted automated tests were added/updated yet for the new `spawnAgent(opts, undefined, onMergeTelemetry)` call shape and merge snapshot write lifecycle (initial/running/terminal). Existing string-match tests that assert `spawnAgent(opts)` will need adjustment in a later testing step.

### Suggestions
- Consider threading real `waveIndex` into `spawnMergeAgentV2` in a future step instead of hardcoding `waveIndex: 0`, so snapshot metadata is immediately accurate for downstream dashboard features.
