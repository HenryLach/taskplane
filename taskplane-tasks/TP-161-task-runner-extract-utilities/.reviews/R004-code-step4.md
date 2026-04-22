## Code Review: Step 4: Update all test imports

### Verdict: APPROVE

### Summary
The Step 4 implementation matches the planned outcomes: all six direct-import test files were switched to their extracted module locations, and the context-window tests correctly adapted call sites to the new `resolveContextWindow(configuredWindow, ctx)` signature. The `project-config-loader` import move for `_loadAgentDef` is correctly wired to `execution.ts` while intentionally retaining `task-runner` imports that still back live behavior in TP-161. I also ran the updated test set, and all targeted suites passed.

### Issues Found
1. **[Severity: minor]** No blocking issues found.

### Pattern Violations
- None observed.

### Test Gaps
- None for this step. Targeted verification run passed:
  - `context-pressure-cache.test.ts`
  - `context-window-autodetect.test.ts`
  - `context-window-resolution.test.ts`
  - `project-config-loader.test.ts`
  - `sidecar-tailing.test.ts`
  - `task-runner-review-skip.test.ts`

### Suggestions
- For TP-162 follow-up, migrate remaining test-only reset hooks off `task-runner.ts` (e.g., toward `execution.resetPointerWarning`) before file deletion to keep the cutover smooth.
