## Code Review: Step 6: Testing & Verification

### Verdict: REVISE

### Summary
The TP-187 changes are close, but there are two blocking wiring defects in the new lane-termination suppression flow. One path references an undeclared callback (runtime failure risk on task-failure handling), and another leaves suppression stuck because lane-respawn unmute is never actually emitted while lanes are reused across waves. I also verified the new targeted test file passes; however, current tests are mostly source-string assertions and did not catch these runtime wiring gaps.

### Issues Found
1. **[extensions/taskplane/engine.ts:1964-1978,2007-2010] [important]** — `executeOrchBatch()` uses `onLaneTerminated` inside `emitLaneTerminated`, but `onLaneTerminated` is not in the function signature. This can throw `ReferenceError: onLaneTerminated is not defined` when the callback runs (notably in the hard-fail path at `engine.ts:3102`).  
   **Fix:** add `onLaneTerminated?: LaneTerminatedCallback | null` to `executeOrchBatch`’s signature and thread it through all call sites (`engine-worker.ts`, extension fallback path).

2. **[extensions/taskplane/extension.ts:1712,2286-2288; extensions/taskplane/engine-worker.ts:53,341-343; extensions/taskplane/waves.ts:1183] [important]** — Zombie-alert suppression is keyed by lane/agent and only lifted on `lane-respawned`/resume/new-batch, but `lane-respawned` is never emitted from engine-worker/engine (only `lane-terminated` is sent). Since lanes are reused across waves, a terminated lane can remain suppressed for the rest of the batch, dropping legitimate future alerts.  
   **Fix:** emit `lane-respawned` when a lane is re-allocated (or before executing a fresh task on an existing lane), and ensure batchId-scoped unmute is wired end-to-end.

3. **[extensions/taskplane/resume.ts:1060-1073,2060-2080; extensions/taskplane/engine-worker.ts:347-360] [important]** — Resume path does not accept/propagate `onLaneTerminated`. `engine-worker` passes a callback argument, but `resumeOrchBatch` signature ignores it, and its `executeWave` call does not forward it. Result: resumed batches won’t report lane terminations to the suppression filter.  
   **Fix:** extend `resumeOrchBatch` signature with optional `onLaneTerminated`, pass it from `engine-worker`, and forward it into `executeWave(..., onLaneTerminated)`.

### Pattern Violations
- None beyond the callback-threading regressions above.

### Test Gaps
- New TP-187 tests are predominantly static source inspections (`toContain(...)`) and do not execute the IPC callback chain (`engine-worker -> extension`) for lane termination/respawn lifecycle.
- Missing behavioral test that runs at least a minimal wave sequence across two waves with lane reuse to verify suppression is lifted correctly.

### Suggestions
- Add one integration-style test that simulates: lane termination in wave N, lane reuse in wave N+1, and verifies alerts are delivered again after respawn.
- Quality-check note: no configured `typecheck`/`lint`/`format:check` commands were found in `.pi/taskplane-config.json` (missing) or package scripts, so static quality gates were not runnable in this review.
