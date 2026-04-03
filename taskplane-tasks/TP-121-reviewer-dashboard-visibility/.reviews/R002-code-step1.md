## Code Review: Step 1: Bridge extension — write reviewer telemetry to file

### Verdict: APPROVE

### Summary
The Step 1 bridge changes in `agent-bridge-extension.ts` implement the required telemetry flow: reviewer RPC stdout is parsed as JSON lines, telemetry is accumulated, `.reviewer-state.json` is written atomically on `message_end`, terminal `done/error` state is emitted on process close/error, and cleanup is performed on all review-step return paths. This aligns with the task’s file-based bridge architecture and preserves existing `review_step` behavior. I did not find blocking correctness issues for this step.

### Issues Found
1. **[extensions/taskplane/agent-bridge-extension.ts:324] [minor]** Reviewer state is first emitted on `message_end`, so very short reviews may have little/no visible "running" window. Suggested improvement: emit an initial `running` state immediately after spawn (before first event) to maximize dashboard visibility.

### Pattern Violations
- None identified.

### Test Gaps
- No step-local automated coverage yet for reviewer-state emission/cleanup behavior (expected later in Step 5). Add tests for: invalid JSON-line tolerance, terminal `done/error` write, and guaranteed cleanup on success + failure paths.

### Suggestions
- Clear any pre-existing stale `.reviewer-state.json` at the start of `review_step` before spawning a new reviewer, to reduce stale-telemetry edge cases after abnormal termination.
- Consider mirroring `agent-host`’s `StringDecoder` approach for stdout decoding to be extra defensive against multi-byte chunk boundaries.
