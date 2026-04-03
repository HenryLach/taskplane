## Plan Review: Step 1: Process-level error handlers

### Verdict: APPROVE

### Summary
The Step 1 plan covers the required outcomes from PROMPT.md: adding both `uncaughtException` and `unhandledRejection` handlers in `engine-worker.ts`, sending IPC diagnostics (including stack context), and ensuring delivery before process exit. This is appropriately scoped for a small, low-risk step and aligns with the current failure mode in `startBatchInWorker` where non-zero exits currently lack detailed crash context.

### Issues Found
1. **[Severity: minor]** — No blocking gaps found for Step 1 outcomes.

### Missing Items
- None.

### Suggestions
- Explicitly note in implementation that handlers must be registered only in the child-process execution path (`TASKPLANE_ENGINE_FORK` guard), since `engine-worker.ts` is also imported by `extension.ts` for types/helpers.
- Normalize non-`Error` rejection reasons in the handler payload (e.g., `String(reason)`) so diagnostics are consistently useful.
