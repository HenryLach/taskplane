## Code Review: Step 3: Produce Structured Exit Diagnostic

### Verdict: REVISE

### Summary
The step adds the core tmux-side diagnostic plumbing (`readExitSummary`, `buildExitDiagnostic`, kill-reason tracking, and lane-state emission) and extends persisted schemas additively with `exitDiagnostic`. However, the new `exitDiagnostic` field is not preserved through the existing outcome upsert/sync pipeline, so diagnostics can be dropped before persistence updates. That breaks the intended resumable-state contract for this new field.

### Issues Found
1. **[extensions/taskplane/persistence.ts:64-72,157-167,173-183,189-199,218-228] [important]** — `exitDiagnostic` is not included in outcome change detection or monitor-sync carry-forward. `upsertTaskOutcome()` ignores `prev.exitDiagnostic !== next.exitDiagnostic`, and `syncTaskOutcomesFromMonitor()` rebuilds outcomes without `exitDiagnostic`. When a task status transitions (e.g., running → succeeded/failed), the replacement record drops the diagnostic, so `serializeBatchState()` cannot persist it.  
   **Fix:**
   - Include `exitDiagnostic` in `upsertTaskOutcome()` comparison.
   - Preserve `existing?.exitDiagnostic` in all `syncTaskOutcomesFromMonitor()` upsert payloads (same pattern as partial-progress fields).
   - Add a regression test proving `exitDiagnostic` survives sync/upsert transitions.

### Pattern Violations
- None blocking, but this change currently diverges from the established optional-field propagation pattern used for `partialProgressCommits` / `partialProgressBranch`.

### Test Gaps
- Missing unit tests for `upsertTaskOutcome()` and `syncTaskOutcomesFromMonitor()` with `exitDiagnostic` present.
- Missing persistence round-trip test (runtime outcome with `exitDiagnostic` → `serializeBatchState()` → `validatePersistedState()` / resume path).

### Suggestions
- In `extensions/task-runner.ts`, either remove `contextKilled` from `BuildExitDiagnosticInput` or extend `ExitClassificationInput`/`classifyExit()` to consume it; right now it is collected but unused in classification.
