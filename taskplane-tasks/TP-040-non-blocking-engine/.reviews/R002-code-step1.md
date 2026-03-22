## Code Review: Step 1: Engine Event Infrastructure

### Verdict: REVISE

### Summary
The implementation adds the core event contract (`EngineEvent`), JSONL emission, and most transition hooks in `executeOrchBatch()`. However, there are blocking gaps where terminal events are not emitted for several real failure/completion paths, which breaks the stated “events at state transitions” outcome and will leave Step 2’s non-blocking consumers without a deterministic terminal signal. There is also a merge-failure branch that notifies the user but never emits the corresponding `merge_failed` event.

### Issues Found
1. **[extensions/taskplane/engine.ts:515-679]** **[critical]** — Multiple early-return paths set `batchState.phase` to `failed`/`completed` and return before the terminal event block at lines 2005-2021. Affected paths include: detached HEAD, preflight failure, fatal discovery errors, no pending tasks, graph/wave validation failures, and orch-branch creation failures. This means no `batch_complete`/`batch_paused` event is written/callbacked for these runs, so external consumers cannot reliably observe terminal state. **Fix:** route all exits through a single finalize path (or helper) that persists terminal state and emits the appropriate terminal event before returning.
2. **[extensions/taskplane/engine.ts:1132-1147]** **[important]** — In the `mergeableLaneCount === 0 && mixedOutcomeLanes.length > 0` branch, the code constructs a partial `mergeResult` and emits user notification, but does not emit `merge_failed`. This omits a required lifecycle transition from the event stream for a real merge-failure mode. **Fix:** emit `merge_failed` in this branch with `laneNumber` and `error/failureReason`, consistent with the main merge-failure branch.

### Pattern Violations
- Event emission is not consistently tied to all phase transitions; some transitions are message-only (`onNotify`) without corresponding structured event output.

### Test Gaps
- No tests verify terminal event emission for planning-phase early exits (preflight/discovery/validation/branch creation failures, and no-pending completion).
- No test covers mixed-outcome/no-mergeable-lane path asserting `merge_failed` emission.
- No direct test coverage for `emitEngineEvent()` callback invocation and best-effort failure handling.

### Suggestions
- Consider deduplicating `batch_paused` emissions for stop policies (currently emitted at stop point and again in terminal block) to keep event semantics one-transition/one-event.
