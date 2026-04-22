## Code Review: Step 1: Engine Event Infrastructure

### Verdict: REVISE

### Summary
Step 1 lands the core pieces: `EngineEvent` types, a JSONL emitter in persistence, and event hooks for most execution/merge transitions. However, there are blocking gaps where terminal outcomes and one merge-failure path do not emit structured events. As written, non-blocking consumers can miss deterministic completion/failure signals in valid execution paths.

### Issues Found
1. **[extensions/taskplane/engine.ts:514-519, 550-555, 571-597, 599-604, 612-619, 623-630, 669-679]** **[critical]** — Multiple early-return paths set terminal phase (`failed`/`completed`) and return before the terminal event emission block at `2005-2021`. This includes detached HEAD, preflight failure, fatal discovery, no-pending completion, graph/wave validation failure, and orch-branch creation failure. Result: no `batch_complete`/`batch_paused` event is emitted to callback or `.pi/supervisor/events.jsonl` for these runs. **Fix:** route all returns through a shared terminal-finalization helper (persist + terminal event), or explicitly emit terminal events in each early-return path.
2. **[extensions/taskplane/engine.ts:1132-1147]** **[important]** — In the `mergeableLaneCount === 0 && mixedOutcomeLanes.length > 0` branch, the code notifies via `orchMergeFailed(...)` but does not emit a `merge_failed` engine event. This drops a required lifecycle transition from the event stream for a real failure mode. **Fix:** emit `merge_failed` in this branch with `laneNumber` and `error/failureReason`, matching the main merge-failure branch at `1112-1117`.

### Pattern Violations
- Event emission is not consistently aligned with phase transitions; some terminal transitions are notify-only without structured event output.

### Test Gaps
- Missing tests for terminal event emission on planning-phase exits (preflight/discovery/validation/branch-creation failures and no-pending completion).
- Missing test for mixed-outcome/no-mergeable-lane merge path asserting `merge_failed` emission.
- Missing direct test coverage for `emitEngineEvent()` callback invocation behavior.

### Suggestions
- Consider avoiding duplicate `batch_paused` events for stop-policy paths (emitted at stop site and again in terminal block) to keep one transition → one terminal event semantics.
