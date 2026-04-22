## Code Review: Step 2: Implement request_segment_expansion tool

### Verdict: REVISE

### Summary
The bridge tool implementation is solid on schema/validation/response shape, and the segment-context env wiring (`TASKPLANE_ACTIVE_SEGMENT_ID`, `TASKPLANE_TASK_ID`) is now present. However, the autonomy plumbing is still effectively broken in real runs: the value is read from a config path that is not present in the legacy orchestrator config object, so workers are always told autonomy is `autonomous`. That means the required non-autonomous rejection behavior is not reliably enforced.

### Issues Found
1. **[extensions/taskplane/execution.ts:2238] [important]** — `supervisorAutonomy` is derived from `(config as any)?.orchestrator?.supervisor?.autonomy`, but the legacy orchestrator config produced by `toOrchestratorConfig()` does not include any `supervisor` field (`extensions/taskplane/config-loader.ts:1091-1139`). In normal execution this resolves to the fallback (`"autonomous"`), so `TASKPLANE_SUPERVISOR_AUTONOMY` is always set to autonomous (`extensions/taskplane/lane-runner.ts:319`) and non-autonomous guard behavior becomes unreachable.  
   **Fix:** Source autonomy from the actual supervisor config path (or thread it explicitly from `loadSupervisorConfig` through engine/execution to lane-runner), and add a regression test that exercises the full wiring path (configured supervised/interactive mode -> worker env -> tool returns `accepted: false`).

### Pattern Violations
- Use of `(config as any)` in `execution.ts` bypasses the declared config contract and hid this mismatch. Prefer explicit typed plumbing for supervisor autonomy.

### Test Gaps
- No test currently verifies autonomy propagation from orchestrator/supervisor configuration into worker environment.
- No integration-level test confirms that a non-autonomous configured run causes `request_segment_expansion` to reject in actual lane execution (not just direct env-injected unit test).

### Suggestions
- Keep the new unit tests in `segment-expansion-tool.test.ts`, but add one wiring test around `executeLaneV2`/lane-runner env construction to prevent regressions in config-path mapping.
