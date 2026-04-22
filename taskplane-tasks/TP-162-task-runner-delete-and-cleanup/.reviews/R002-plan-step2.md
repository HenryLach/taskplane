## Plan Review: Step 2: Remove dead code from execution.ts

### Verdict: APPROVE

### Summary
The Step 2 plan is well scoped to the required outcome in PROMPT.md: remove the dead `resolveTaskRunnerExtensionPath()` helper and clean legacy TASK_AUTOSTART comment references in `execution.ts`. This is a low-risk, localized change that directly supports the broader TP-162 goal of eliminating `task-runner.ts` coupling. The planned work is sufficient for this step without over-specifying implementation details.

### Issues Found
1. None.

### Missing Items
- None for Step 2 scope.

### Suggestions
- After edits, run a targeted verification grep in `execution.ts` for both `resolveTaskRunnerExtensionPath` and `TASK_AUTOSTART` to make completion evidence explicit in the execution log.
- If deleting the helper leaves `resolveTaskplanePackageFile` unused in this file, consider removing the unused import while touching the file.
