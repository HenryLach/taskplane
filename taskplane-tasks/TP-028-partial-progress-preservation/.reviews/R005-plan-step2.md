## Plan Review: Step 2: Record Partial Progress in Task Outcome

### Verdict: REVISE

### Summary
The Step 2 plan has the right intent, but it is still too high-level to guarantee the outcome fields actually flow from preservation logic into persisted task state. In the current code, partial-progress data is produced at cleanup call sites, while task-state serialization and resume reconstruction happen elsewhere. The plan should explicitly cover those integration points and compatibility behavior.

### Issues Found
1. **[Severity: important]** — The plan does not identify where `partialProgressCommits` / `partialProgressBranch` will be written back into accumulated task outcomes. `STATUS.md:46-48` says “populate fields during progress save,” but the concrete producers are `preserveFailedLaneProgress()` results (`extensions/taskplane/worktree.ts:2144-2150,2251-2295`) and the active call sites in `engine.ts:533-549,781-804` and `resume.ts:1340-1357,1431-1457`. Add an explicit outcome to map those per-task results onto `allTaskOutcomes` before subsequent persistence checkpoints.
2. **[Severity: important]** — Persistence wiring is underspecified. Adding fields to `LaneTaskOutcome`/`PersistedTaskRecord` alone is insufficient unless `serializeBatchState()` writes them (`extensions/taskplane/persistence.ts:721-730`) and outcome update detection handles them (`extensions/taskplane/persistence.ts:55-69`). Add explicit plan items for serializer mapping and outcome-change propagation/defaulting.
3. **[Severity: important]** — Resume/backward-compat behavior is missing. Resume rebuilds outcomes from persisted task records (`extensions/taskplane/resume.ts:1013-1026`); if new fields are required in-memory but absent in older state files, defaults must be applied. Also avoid making persisted fields hard-required in validation (`extensions/taskplane/persistence.ts:470-505`) unless schema/version migration is explicitly planned.

### Missing Items
- Explicit default contract for tasks without preserved progress (`partialProgressCommits = 0`, `partialProgressBranch = null`) across all outcome constructors.
- Test coverage intent for persistence/resume paths (not just branch creation): serialized `batch-state.json` includes fields, and resume from older/newer state remains valid.

### Suggestions
- Add one Step 2 checkbox for each integration layer: outcome mutation, serializer mapping, and resume reconstruction/defaulting.
- In Step 3, include one regression test that round-trips `LaneTaskOutcome -> PersistedTaskRecord -> resumed LaneTaskOutcome` with/without partial-progress fields.
