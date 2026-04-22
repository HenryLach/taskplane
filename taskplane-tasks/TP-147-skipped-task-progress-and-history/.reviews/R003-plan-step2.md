## Plan Review: Step 2 — Fix batch history completeness

### Verdict: APPROVE

### Summary
The plan's outcomes are correct: ensure all wave plan tasks appear in batch history (including never-started, blocked, and skipped tasks) and that `totalTasks` matches the task array length. The checkboxes describe the right outcomes. The worker demonstrated strong codebase navigation in Step 1 (working across engine.ts and worktree.ts despite the PROMPT listing specific files), so they should be able to locate the correct code.

### Issues Found
None critical.

### Missing Items
None — the four checkboxes cover the key outcomes:
- All wave plan tasks in history (the root cause of #455)
- Proper status for unstarted tasks
- totalTasks consistency assertion
- Targeted test run

### Suggestions
- **Important — Code location awareness:** The PROMPT lists `persistence.ts` as the artifact, but the batch history *builder* code (the source of the bug) lives in **`engine.ts` around line 3828–3862**. The `taskSummaries` array is built via `allTaskOutcomes.map(...)`, which only includes tasks that received an outcome entry. Tasks in future waves that never got allocated (and thus never seeded into `allTaskOutcomes`) are the ones missing from history. The `saveBatchHistory()` and `loadBatchHistory()` functions in `persistence.ts` are just load/save helpers — they faithfully persist whatever summary they're given. The fix needs to happen either: (a) in the batch history builder in `engine.ts` by iterating over `wavePlan` task IDs and filling in defaults for tasks not in `allTaskOutcomes`, or (b) by ensuring `allTaskOutcomes` is complete before the builder runs (e.g., seeding pending outcomes for all wave plan tasks, not just the current wave's allocated lanes). Note that `serializeBatchState()` in `persistence.ts` already does this correctly for `batch-state.json` — it builds a full `taskIdSet` from `wavePlan` — so the pattern to follow is right there.
- **Minor — BatchTaskSummary status type:** The `BatchTaskSummary.status` type in `types.ts:3205` is `"succeeded" | "failed" | "skipped" | "blocked" | "stalled"`. It does not include `"pending"`. If the worker wants to record never-started tasks as `"pending"`, they'll need to extend this union type. Alternatively, mapping never-started tasks in unexecuted waves as `"blocked"` (since they were blocked by the batch stopping early) fits the existing type without changes.
