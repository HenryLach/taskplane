## Plan Review: Step 3: Delete task-runner.ts

### Verdict: REVISE

### Summary
The Step 3 intent is correct, but the current plan is not complete enough to safely delete `extensions/task-runner.ts` and still satisfy the task-level completion criteria (full test suite passing). The checklist currently focuses on deletion and high-level checks, but it does not fully account for all existing test dependencies on `task-runner.ts`. Without expanding this step, Step 5 will fail with `ENOENT`/import-resolution errors.

### Issues Found
1. **[Severity: important]** — `STATUS.md:43-45` does not include explicit outcomes to resolve known test imports before deletion. There are still direct imports from `../task-runner.ts` in active tests (`extensions/tests/context-window-resolution.test.ts:18`, `extensions/tests/context-window-autodetect.test.ts:18`, `extensions/tests/project-config-loader.test.ts:48,1512`). Add explicit Step 3 checklist items to move these imports to their new module homes before deleting the file.
2. **[Severity: critical]** — The discovery inventory for source-reading tests appears incomplete; multiple additional tests still read `task-runner.ts` as a source file (for example: `extensions/tests/task-runner-rpc.test.ts:8`, `task-runner-rpc-integration.test.ts:8`, `task-runner-orchestration.test.ts:8`, `task-runner-step-status.test.ts:26`, `task-runner-duplicate-log.test.ts:25`, `task-runner-exit-diagnostic.test.ts:8`, `runtime-model-fallback.test.ts:412`). Step 3 must include a complete audit/disposition for **all** such tests (update target file, migrate assertions, or remove obsolete tests), not just the three currently listed in Discoveries.

### Missing Items
- Promote the Step 3 dispositions currently buried in Discoveries (`STATUS.md:93-96`) into concrete Step 3 checkboxes so they are guaranteed execution-tracked.
- Add an explicit “no remaining `task-runner.ts` references in `extensions/tests`” outcome (imports + source-read paths), not only a generic “no remaining imports.”

### Suggestions
- Keep the scope outcome-oriented: a single Step 3 checklist item like “resolve all remaining test dependencies on task-runner.ts found in preflight inventory” is enough; no need to split into function-level micro-steps.
