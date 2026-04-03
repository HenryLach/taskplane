## Plan Review: Step 1: Bridge extension — write reviewer telemetry to file

### Verdict: APPROVE

### Summary
The Step 1 plan covers the required outcomes for bridge-side reviewer telemetry: parsing reviewer RPC output, accumulating token/tool/cost metrics, persisting runtime state to `.reviewer-state.json`, setting terminal status, and cleanup. This is aligned with the task prompt’s intended architecture (bridge writes, lane-runner reads). I don’t see blocking gaps that would prevent Step 1 from being implemented correctly.

### Issues Found
1. **[Severity: minor]** The plan does not explicitly call out malformed/partial JSON-line handling while parsing reviewer stdout. Suggested fix: ignore invalid lines defensively (as agent-host does) and continue parsing.

### Missing Items
- None blocking for Step 1 outcomes.

### Suggestions
- Write an initial `{ status: "running", ... }` reviewer state as soon as the subprocess starts (before first `message_end`) so dashboard visibility can begin immediately.
- Use best-effort cleanup in all exit paths (success, non-zero exit, timeout/error) to avoid stale `.reviewer-state.json` files.
- Consider atomic file writes (temp file + rename) to reduce transient read/parse races for lane-runner.
