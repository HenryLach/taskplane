## Code Review: Step 2: Implement request_segment_expansion tool

### Verdict: REVISE

### Summary
The tool implementation itself is well-structured: schema, validation, rejection shape, and accepted-path request construction all align with the step intent. However, two runtime wiring gaps make the feature effectively unavailable in real worker runs: segment-context gating and autonomy gating both depend on env vars that are not currently populated by the launcher path. As written, Step 2 will not reliably achieve its stated outcomes without follow-up fixes.

### Issues Found
1. **[extensions/taskplane/agent-bridge-extension.ts:208] [important]** — `request_segment_expansion` is only registered when `resolveActiveSegmentId()` returns a value, but that resolver depends on `TASKPLANE_ACTIVE_SEGMENT_ID`/`TASKPLANE_SEGMENT_ID`, and neither is set in worker spawn env (`extensions/taskplane/lane-runner.ts:306-316`). In normal workspace segment execution, this means the tool is not registered at all.  
   **Fix:** Thread active segment ID into worker env during spawn (e.g., `TASKPLANE_ACTIVE_SEGMENT_ID: segmentId ?? ""`) or switch registration gating to a signal that is already available at runtime.

2. **[extensions/taskplane/agent-bridge-extension.ts:245] [important]** — The non-autonomous guard depends on `TASKPLANE_SUPERVISOR_AUTONOMY`, but this variable is also not set in worker spawn env (`extensions/taskplane/lane-runner.ts:306-316`). Because `resolveSupervisorAutonomy()` defaults to `"autonomous"`, supervised/interactive rejection is effectively unreachable in normal runs, missing the required V1 behavior.  
   **Fix:** Thread supervisor autonomy into worker env from orchestrator config, and add a regression test for supervised/interactive rejection (`accepted: false`, required message, no file write).

### Pattern Violations
- None beyond the runtime env plumbing gaps above.

### Test Gaps
- No tests currently validate tool registration behavior with/without segment context env.
- No tests validate non-autonomous mode rejection path in the real extension registration/execution flow.
- No tests in this step verify request file emission for the accepted path (planned for Step 4, but currently leaves these regressions undetected).

### Suggestions
- Pass `TASKPLANE_TASK_ID` from lane-runner as well, so request payload generation doesn’t rely on fallback parsing of folder names.
