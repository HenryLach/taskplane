## Code Review: Step 2: Batch Summary Generation

### Verdict: REVISE

### Summary
The step adds a substantial summary pipeline (collection, formatting, file write, and operator presentation) and correctly wires summary generation into most terminal paths, including auto-mode PR lifecycle completion. However, supervised-mode sequencing does not match the step requirement: the summary is emitted before integration is executed/confirmed. That means the implementation can produce a “post-integration” summary prior to integration outcomes.

### Issues Found
1. **[extensions/taskplane/supervisor.ts:923-927] [important]** — In `triggerSupervisorIntegration(...)`, supervised mode calls `presentBatchSummary(...)` immediately after sending the confirmation plan, before `/orch-integrate` runs.
   - **Why this is blocking:** Step 2 requires summary generation **after integration** (manual mode is the only exception for batch-complete timing) per `PROMPT.md:88`.
   - **Suggested fix:** Remove immediate summary emission from supervised branch and trigger summary when supervised integration actually concludes (success/failure/decline), e.g., by hooking `/orch-integrate` completion path (or an explicit supervised-decline path) to call `presentBatchSummary(...)` before final supervisor deactivation.

### Pattern Violations
- None major.

### Test Gaps
- Missing regression test that supervised mode does **not** emit the batch summary until after operator-confirmed integration completes.
- Missing sequencing test for supervised “operator declines integration” path (expected summary timing and supervisor teardown behavior).

### Suggestions
- Add a focused unit/integration test around `triggerSupervisorIntegration(..., "supervised", ...)` to lock sequencing and prevent future regressions.
