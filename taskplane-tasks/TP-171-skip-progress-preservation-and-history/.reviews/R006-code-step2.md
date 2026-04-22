## Code Review: Step 2: Fix Batch History Task Gap

### Verdict: APPROVE

### Summary
The Step 2 code change is safe and improves correctness in batch history serialization by preventing invalid task status values from leaking into `BatchTaskSummary` entries. Mapping non-terminal/unknown outcome statuses (notably `running`) to `pending` aligns runtime values with the declared history contract and avoids downstream schema/consumer drift. Existing TP-147 gap-filling logic for wave-plan coverage remains intact.

### Issues Found
1. **[File:Line] [minor]** No blocking correctness issues found in this diff.

### Pattern Violations
- None observed.

### Test Gaps
- No engine-path regression test was added for the new status normalization at `extensions/taskplane/engine.ts:4030-4036` (e.g., paused/aborted mid-wave where an outcome remains `running` and history should persist as `pending`).
- No targeted scenario in this step directly exercises end-to-end “all wave-plan task IDs appear in `summary.tasks`” through `executeOrchBatch` (beyond persistence I/O tests).

### Suggestions
- Add a focused engine-level regression test in Step 3 that builds a mixed outcome set (succeeded/failed/skipped/running + never-started task) and asserts:
  - all wave-plan task IDs are present in history,
  - `running` is normalized to `pending`, and
  - `totalTasks === summary.tasks.length`.
