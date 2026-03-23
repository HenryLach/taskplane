## Code Review: Step 1: Supervisor-Managed Integration

### Verdict: REVISE

### Summary
The step makes solid progress on integration mode wiring (`manual|supervised|auto`) and branch-protection planning, but there are blocking lifecycle gaps in when integration is triggered and how completion is finalized. As implemented, integration can run for non-complete batches, and the new supervisor flow does not yet implement the required CI wait/merge lifecycle from the task prompt. These issues risk incorrect integration behavior and stale supervisor state across later batches.

### Issues Found
1. **[extensions/taskplane/extension.ts:1218-1229, 1501-1510; extensions/taskplane/supervisor.ts:413-423] [critical]** — Integration is triggered from `onTerminal` for all end states in supervised/auto modes, but `buildIntegrationPlan()` does not gate on `batchState.phase === "completed"`.
   - Impact: paused/stopped batches (including resumable partial-failure runs) can still be integrated if they have succeeded tasks + orch branch, violating the Step 1 requirement to trigger on `batch_complete` and risking premature integration.
   - Fix: gate trigger/integration planning to completed batches only (or explicitly wire from `batch_complete` event callback), and skip integration for `paused|stopped|failed` with a supervisor status message instead.

2. **[extensions/taskplane/supervisor.ts:607-650; extensions/taskplane/extension.ts:379-558] [critical]** — The supervisor flow currently emits free-form git/gh instructions instead of reusing the existing `/orch-integrate` execution path, and it does not implement PR CI wait/check/merge lifecycle.
   - Impact: misses prompt-required lifecycle (`create PR -> wait for CI -> merge -> cleanup`) and bypasses existing integration safeguards (`resolveIntegrationContext`/`executeIntegration`, autostash handling, cleanup behavior).
   - Fix: call shared integration helpers programmatically (extract to a neutral module if needed), then add explicit CI status polling + merge handling for PR mode with failure reporting/retry guidance.

3. **[extensions/taskplane/supervisor.ts:579-657] [important]** — There is no deterministic deactivation path after a successful integration plan execution.
   - Impact: when a plan exists, the code only sends a message and relies on the LLM to "deactivate" itself, but no API call path performs `deactivateSupervisor(...)`; this can leave heartbeat/tailer active and leak supervisor state into subsequent batches.
   - Fix: add an explicit code-driven completion signal/callback that deactivates supervisor after integration flow finishes (or times out/fails and hands off).

### Pattern Violations
- Integration behavior is duplicated in supervisor prompt text rather than routed through the established `/orch-integrate` implementation (`resolveIntegrationContext` + `executeIntegration`), increasing drift risk.

### Test Gaps
- Missing regression test that supervised/auto integration **does not** trigger for `paused`/`stopped` outcomes.
- Missing tests for PR lifecycle behavior (CI wait success, CI failure escalation, merge/cleanup outcomes).
- Missing test that supervisor is deactivated after integration flow completion.

### Suggestions
- Remove the currently unused `onBatchComplete` callback plumbing in `processEvents()` or wire it fully to avoid dead-path confusion.
