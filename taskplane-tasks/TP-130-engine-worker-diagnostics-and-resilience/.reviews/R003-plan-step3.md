## Plan Review: Step 3: Snapshot failure counter

### Verdict: REVISE

### Summary
The step captures the intended outcomes at a high level (count failures, stop interval after threshold, reset on success), but it is missing one implementation-critical outcome. In the current code, `emitSnapshot` is explicitly non-throwing and swallows errors internally, so a counter “around the call” cannot detect failures unless the plan adds a non-throwing failure signal path.

### Issues Found
1. **[Severity: important]** — The plan does not specify how `reviewerRefresh` will observe snapshot failures. In `extensions/taskplane/lane-runner.ts`, `emitSnapshot` catches and swallows all errors by contract, so try/catch in the interval callback will never increment a failure counter. **Suggested fix:** add an explicit success/failure signal that preserves the non-throwing contract (for example, `emitSnapshot` returns `true/false`), then base the consecutive counter on that signal.

### Missing Items
- Explicit outcome: define a non-throwing failure-reporting mechanism from `emitSnapshot` to `reviewerRefresh` so the threshold logic can actually trigger.

### Suggestions
- Include a clear warning payload when disabling refresh (task/lane id + consecutive failure count) to aid diagnosis.
- Add a targeted test for threshold behavior (5 consecutive failures disables refresh; a success resets the counter) even if lightweight/mocked.
