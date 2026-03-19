## Code Review: Step 2: Read Sidecar Telemetry During Polling

### Verdict: REVISE

### Summary
The tmux polling integration is a solid step forward: incremental JSONL tailing, token/cost accumulation, and context% updates are wired into the existing state flow without touching `/orch` execution paths. However, retry telemetry semantics are currently incorrect across poll ticks, so dashboard-visible retry state can become stale or flip incorrectly. There is also no test coverage added for the new tailing/retry logic, which makes this regression-prone.

### Issues Found
1. **[extensions/task-runner.ts:1181-1183, 1239-1248, 1253, 1483-1499, 2013]** **[important]** — `retryActive` is computed only from events seen in the current tick (`retryActiveInTick` starts `false` every call), then written directly to `state.workerRetryActive`. This breaks cross-tick semantics: 
   - a tick with non-retry events during an active retry can incorrectly clear `workerRetryActive`;
   - a tick with only `auto_retry_end` may never invoke `onTelemetry` (truthy-gated callback), leaving `workerRetryActive` stuck `true`.
   **Fix:** persist retry-active state across calls (e.g., store in `SidecarTailState`), update it on `auto_retry_start/end`, and dispatch telemetry whenever retry state changes (or when any event was parsed), not only when selected numeric fields are truthy.

2. **[extensions/tests/task-runner-rpc.test.ts (missing)]** **[important]** — No tests were added for Step 2 behavior despite new parsing/state logic in a core runtime path. This violates the project expectation to add/update tests for behavior changes.
   **Fix:** add focused tests for `tailSidecarJsonl` + tmux poll callback integration (retry start/end across multiple ticks, partial-line buffering, missing-file early polls, and final-tail-on-session-end).

### Pattern Violations
- Project standard in `AGENTS.md` (“Add or update tests for behavior changes”) is not met for this step.

### Test Gaps
- Retry lifecycle across ticks: `auto_retry_start` in tick N, unrelated events in tick N+1, `auto_retry_end` in tick N+2.
- End-only retry transition: ensure `workerRetryActive` clears when a tick contains only `auto_retry_end`.
- Final tail behavior on session shutdown: retry state and last error should not be dropped.
- Incremental tail robustness: partial JSON line split across reads and malformed line skip behavior.

### Suggestions
- Replace the current “truthy field” callback gate with an explicit `hadParsedEvents` / `stateChanged` flag to avoid dropping zero-valued but meaningful transitions.
- Consider aligning telemetry event accumulation logic with `bin/rpc-wrapper.mjs` state semantics to reduce drift between producer and consumer.
