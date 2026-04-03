## Plan Review: Step 2: Lane-runner — read reviewer state into snapshot

### Verdict: REVISE

### Summary
The Step 2 plan is close, but it misses a blocking runtime behavior: relying only on the worker `onTelemetry` callback is unlikely to produce reviewer visibility while review is actually running. In the current code path, telemetry callbacks are emitted on worker `message_end` events, while reviewer execution happens inside a blocking tool call and clears `.reviewer-state.json` before control returns. Without an additional polling/refresh mechanism, the dashboard sub-row may still never appear.

### Issues Found
1. **[Severity: important]** — Plan depends on `onTelemetry` cadence that does not align with reviewer runtime, so reviewer state may never be observed as `running`.
   - Evidence: `agent-host.ts:599-601` emits `onTelemetry` in the `message_end` branch; `lane-runner.ts:287-304` emits snapshots only from that callback; `agent-bridge-extension.ts:519` removes `.reviewer-state.json` before returning tool output.
   - Suggested fix: add a lane-runner refresh path independent of worker `message_end` (e.g., short interval while worker process is alive, or event-driven updates from additional agent-host events) that reads `.reviewer-state.json` and updates `snapshot.reviewer` until state is `done/error` or file disappears.

### Missing Items
- Explicit plan item for **how reviewer telemetry is refreshed during an in-flight `review_step`** (not just on worker message boundaries).

### Suggestions
- In the same implementation, treat reviewer-state read/parse errors as best-effort and fall back to `snapshot.reviewer = null` to avoid callback exceptions affecting lane execution.
- Keep reviewer `agentId` construction centralized (reuse `buildRuntimeAgentId(..., "reviewer")`) to avoid format drift.