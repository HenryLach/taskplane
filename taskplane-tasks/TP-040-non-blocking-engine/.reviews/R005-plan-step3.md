## Plan Review: Step 3: Preserve Existing Behavior

### Verdict: REVISE

### Summary
The Step 3 checklist captures the right high-level compatibility outcomes, but it currently misses two blocking risks introduced by the detached launch model. In particular, command behavior during the pre-launch window is not accounted for, and the prompt’s explicit `/orch-status` disk-state requirement is not represented. Without these additions, the step can be marked complete while still regressing core `/orch-*` operator flows.

### Issues Found
1. **[Severity: critical]** — The plan does not cover the new pre-launch race window created by `startBatchAsync(...setTimeout...)` in `extensions/taskplane/extension.ts`. Right after `/orch` returns, `orchBatchState` can still be `idle` until the timer fires and `executeOrchBatch()` sets phase, which can make `/orch-status` report “No batch,” let `/orch-pause` no-op, and let `/orch-abort` treat the run as nonexistent. **Suggested fix:** add an explicit outcome to preserve command correctness during launch handoff (e.g., synchronous launch marker/state + queued pause/abort semantics before engine boot).
2. **[Severity: important]** — The plan does not explicitly include the prompt requirement that `/orch-status` should read batch state from disk. The current Step 3 text only says commands “still work,” which is too broad to guarantee this contract. **Suggested fix:** add a concrete Step 3 outcome for `/orch-status` disk-backed behavior (including fallback/precedence rules vs in-memory state).

### Missing Items
- Explicit compatibility outcome for immediate post-`/orch` command calls (`/orch-status`, `/orch-pause`, `/orch-abort`, second `/orch`) before the engine’s first tick.
- Explicit `/orch-status` persisted-state validation path aligned to `.pi/batch-state.json` behavior.

### Suggestions
- Reuse one shared “launching” state path for both `/orch` and `/orch-resume` so compatibility fixes and tests apply uniformly.
- Add a targeted compatibility test intent for “command invoked immediately after non-blocking launch” rather than relying only on “existing tests pass.”
