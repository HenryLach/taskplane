## Plan Review: Step 1 — Wire orphan detection into the monitor poll loop

### Verdict: APPROVE

### Summary
The plan is well-specified and technically correct. The proposed code block inserts cleanly into the established pattern in `monitorLanes()`, guards correctly on `runtimeBackend === "v2" && batchId`, wraps in try/catch, and refreshes the registry cache after marking so the same poll cycle sees the updated state. All the referenced functions (`detectOrphans`, `markOrphansCrashed`, `readRegistrySnapshot`) exist and behave as described.

### Issues Found
_None blocking._

### Pattern Violations
_None._

### Test Gaps
- The existing `14.3` structural test (`engine-runtime-v2-routing.test.ts`) validates the registry cache refresh but does not yet assert that `monitorLanes` calls `detectOrphans` or `markOrphansCrashed`. A companion test case (e.g. "14.3b: monitorLanes runs orphan detection each poll cycle") would give regression coverage for this new behaviour. This is not required in Step 1 — the PROMPT already defers test work to Step 4 — but worth noting.

### Suggestions
- **Import update (obvious but worth noting):** `execution.ts` line 14 currently imports only `readRegistrySnapshot, readLaneSnapshot, isTerminalStatus, isProcessAlive` from `./process-registry.ts`. The worker will need to add `detectOrphans` and `markOrphansCrashed` to that import line when implementing. Not a concern — it's a straightforward implementation detail.
- **Reuse the first registry read:** The existing cache-refresh at line ~1173 already calls `readRegistrySnapshot(stateRootForRegistry ?? repoRoot, batchId)`. The proposed orphan-detection block calls it a second time on the very next lines. Capturing the snapshot from the first call and passing it to `detectOrphans(snapshot)` would save one file read per poll cycle when no orphans are found, and two file reads when orphans are found. This is a minor optimisation; both approaches are correct.
- **Placement relative to pause-signal check:** The plan places orphan detection before the `pauseSignal.paused` break. This is fine — it is fast and non-blocking. Just confirming it's intentional.
