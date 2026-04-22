## Plan Review: Step 4: Update all test imports

### Verdict: REVISE

### Summary
The Step 4 plan is close, but in its current form it is too import-focused and misses one required behavioral adaptation discovered in Step 0. Specifically, the context-window tests need call-site updates for the new `resolveContextWindow` signature, and the `project-config-loader` reset-hook migration needs to be explicit to avoid test-state leakage or failures. Tightening those outcomes will make this step executable without rework.

### Issues Found
1. **[Severity: important]** The plan only states import moves for the context-window tests, but Step 0 discoveries already established that `resolveContextWindow` now takes `(configuredWindow, ctx)` instead of `(config, ctx)`. Without explicitly planning call-site adaptation, these tests will fail after import rewiring. Suggested fix: add an outcome-level checkbox to update all `resolveContextWindow(config, ctx)` calls to pass `config.context.worker_context_window`.
2. **[Severity: important]** `project-config-loader.test.ts` migration is underspecified (`execution / config-loader`) and does not explicitly capture the `_resetPointerWarning` replacement path identified in Discoveries. Suggested fix: add a checkbox that the test no longer imports `_resetPointerWarning` from `task-runner.ts` and uses the new execution-side reset hook (or documented equivalent) so per-test pointer-warning state remains resettable.

### Missing Items
- Explicit outcome for context-window **call-site** updates (not just import path updates).
- Explicit outcome for `_resetPointerWarning` migration in `project-config-loader.test.ts`.

### Suggestions
- Add a non-blocking note under “Additional files from Step 0 inventory” that source-reading legacy `/task` tests are intentionally left unchanged in TP-161 (per Discoveries), to avoid accidental churn.
