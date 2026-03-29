## Plan Review: Step 3 — Thread mailbox-dir through spawn paths

### Verdict: REVISE

### Summary
The updated plan correctly fixes the two major issues from R011:
- uses `getSidecarDir()`-anchored mailbox paths in `task-runner` (avoids `.pi/.pi/...`)
- threads `batchId` explicitly into `spawnMergeAgent()`

However, one blocking completeness gap remains: mailbox enablement still is not guaranteed for **all** lane spawn paths.

### Blocking finding

1. **`ORCH_BATCH_ID` propagation is still incomplete for retry/re-exec lane spawns.**
   - The Step 3 plan now depends on `spawnAgentTmux()` reading `process.env.ORCH_BATCH_ID`.
   - In normal wave execution, this env var is passed (`execution.ts` `executeWave()` calls `executeLane(..., { ORCH_BATCH_ID: batchId })`).
   - But engine retry paths call `executeLane(...)` without `extraEnvVars` (e.g., `engine.ts` around the worker-crash retry and model-fallback retry callsites), so those spawned task-runner sessions will not have `ORCH_BATCH_ID` unless explicitly added.
   - Result: mailbox steering may be silently disabled for retried workers/reviewers, violating the “any running agent” intent.

   **Required plan correction:**
   - Add explicit Step 3 work to propagate batch ID for all lane spawns, not just `executeWave`.
   - Either:
     - pass `{ ORCH_BATCH_ID: batchState.batchId }` at all `executeLane` retry callsites (merging with existing extra env like `TASKPLANE_MODEL_FALLBACK`), or
     - refactor `executeLane/spawnLaneSession/buildLaneEnvVars` to accept `batchId` directly and set `ORCH_BATCH_ID` centrally.

### Non-blocking notes
- `merge.ts` plan items look good: explicit `batchId`, mailbox dir creation, and `--mailbox-dir` threading align with current `rpc-wrapper` expectations.
- Keep mailbox arg insertion before `--` passthrough in wrapper args (as already planned).
