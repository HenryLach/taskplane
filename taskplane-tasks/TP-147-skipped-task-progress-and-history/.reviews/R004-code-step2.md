## Code Review: Step 2 — Fix batch history completeness

### Verdict: APPROVE

### Summary
The implementation correctly gap-fills missing tasks from `wavePlan` into `taskSummaries` before building the batch history. Tasks that never started execution are given appropriate `"pending"` or `"blocked"` status based on `batchState.blockedTaskIds`. The `totalTasks` field now uses the authoritative `taskSummaries.length` instead of `batchState.totalTasks`, with a diagnostic warning log on mismatch. The type union in `BatchTaskSummary.status` was correctly extended. All existing tests pass (742/742).

### Issues Found
None blocking.

### Pattern Violations
None. The changes follow project patterns:
- Inline `TP-147` tags for traceability
- Uses `execLog` for diagnostic warnings
- Extends the type union in `types.ts` alongside the runtime change in `engine.ts`
- Dashboard already handles `"pending"` status (app.js line 451, 518, 716)

### Test Gaps
- No new tests were added in this step. Step 3 is dedicated to testing, so this is expected per the PROMPT plan structure. The gap-fill logic (pending/blocked status assignment, totalTasks matching array length) needs coverage in Step 3.

### Suggestions
- **`lane: 0` for gap-filled tasks**: The `BatchTaskSummary.lane` comment says `// 1-based`, but gap-filled tasks use `lane: 0` as a sentinel for "never allocated." This is actually reasonable and the dashboard renders it as `L0`. Consider adding a comment to the type noting `0 = unassigned` so future readers aren't confused.
- **Counter consistency note**: After gap-fill, `totalTasks` will match the task array length, but `succeededTasks + failedTasks + skippedTasks + blockedTasks` may not sum to `totalTasks` (gap-filled "pending" tasks have no corresponding summary counter). This is a pre-existing data model limitation and not introduced by this change. A `pendingTasks` counter on `BatchHistorySummary` would close the gap, but that's out of scope for this task.
