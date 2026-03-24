## Code Review: Step 1 — Add Exit Classification for Model Access Errors

### Verdict: REVISE

### Summary
The Step 1 classification changes themselves are in good shape (`model_access_error` added, precedence updated, and `exit-classification.test.ts` updated accordingly).  
However, the commit range includes additional fallback wiring changes that introduce a blocking runtime mismatch: model fallback is effectively disabled.

### Findings

1. **[Severity: critical] Model fallback gate checks the wrong config object, so fallback never runs.**
   - `attemptModelFallbackRetry()` short-circuits on `orchConfig.failure.model_fallback !== "inherit"` (`extensions/taskplane/engine.ts:375-376`).
   - But `OrchestratorConfig.failure` has no `model_fallback` field (`extensions/taskplane/types.ts:45-51`).
   - The new fallback setting is instead threaded through `TaskRunnerConfig.model_fallback` (`extensions/taskplane/config-loader.ts:816-821`, `extensions/taskplane/types.ts:134-143`).
   - In the same flow, `attemptWorkerCrashRetry()` now explicitly skips `model_access_error` (`extensions/taskplane/engine.ts:137-143`), assuming model fallback will handle it.

   **Impact:** `model_access_error` tasks are skipped by worker-crash retry and also skipped by model-fallback retry (because the gate always evaluates as disabled). This defeats the TP-055 recovery behavior.

   **Suggested fix:** Use a single source of truth for fallback mode. Either:
   - pass/read `runnerConfig.model_fallback` in `attemptModelFallbackRetry`, or
   - move the field to orchestrator failure config and map it consistently end-to-end.

   Then add/adjust a regression test proving fallback executes when mode is `inherit`.
