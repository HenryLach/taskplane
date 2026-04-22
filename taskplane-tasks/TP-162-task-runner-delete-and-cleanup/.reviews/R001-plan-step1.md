## Plan Review: Step 1: Remove from package.json

### Verdict: APPROVE

### Summary
The Step 1 plan is appropriately scoped to the required outcome: removing `task-runner.ts` from both `pi.extensions` and `files`, then validating JSON integrity. It aligns with the task prompt and avoids unnecessary implementation-level detail. This is sufficient to safely complete Step 1 before broader cleanup in later steps.

### Issues Found
1. None.

### Missing Items
- None for Step 1 scope.

### Suggestions
- After editing `package.json`, quickly run a targeted grep (e.g., `grep -n "task-runner\.ts" package.json`) before the JSON validation command to make confirmation explicit in the step log.
