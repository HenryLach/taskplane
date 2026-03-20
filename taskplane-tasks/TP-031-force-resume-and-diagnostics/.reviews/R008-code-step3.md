## Code Review: Step 3: Diagnostic Reports

### Verdict: REVISE

### Summary
The diagnostic report wiring is in the right place (post-`batch-terminal` persist in both engine and resume), and the new module is structured clearly with deterministic sorting and non-fatal writes. However, the current input assembly drops canonical persisted task metadata, which causes incomplete per-task coverage and breaks workspace per-repo attribution. These are requirement-level issues for Step 3 and should be fixed before approval.

### Issues Found
1. **[extensions/taskplane/diagnostic-reports.ts:372-388] [important]** — Diagnostic events are built only from `allTaskOutcomes`, not the canonical persisted task set, so reports can omit tasks that are still pending/blocked/unallocated at terminal time.
   - Why this matters: `serializeBatchState()` intentionally constructs the full task registry from `wavePlan + allTaskOutcomes` (`extensions/taskplane/persistence.ts:989-996`), but `assembleDiagnosticInput()` only maps outcomes. This can produce fewer event rows than `totalTasks` and miss tasks expected in “one line per task from state.tasks[]”.
   - Fix: Build report input from the persisted `tasks[]` equivalent (or reconstruct using `wavePlan` like `serializeBatchState()`), then overlay outcome/diagnostic enrichments.

2. **[extensions/taskplane/diagnostic-reports.ts:375-388,149-150,265] [important]** — Workspace per-repo breakdown cannot be correct because repo attribution is dropped during assembly.
   - Why this matters: `LaneTaskOutcome` has no `repoId/resolvedRepoId` (`extensions/taskplane/types.ts:538-569`), and the assembly mapper never sets repo fields; later grouping uses `evt.repoId ?? "(unresolved)"`, so workspace reports collapse into unresolved buckets instead of actual repo sections.
   - Fix: Source `repoId/resolvedRepoId` from persisted/discovery-enriched task records (same source used by state persistence), then group by that resolved repo id.

### Pattern Violations
- **[extensions/taskplane/diagnostic-reports.ts:318-320]** Comment states failures are appended to `batchState.errors`, but this function has no `batchState` access and currently logs only. Either update comment or pass an error sink explicitly.

### Test Gaps
- No new tests for diagnostic report behavior were added in this step.
- Missing coverage for:
  - terminal report includes all tasks (including pending/blocked),
  - workspace per-repo grouping uses real repo IDs,
  - fallback behavior when `diagnostics.taskExits` is sparse,
  - non-fatal write failure path.

### Suggestions
- Add focused unit tests for `buildDiagnosticEvents`, `buildMarkdownReport`, and `assembleDiagnosticInput` with repo-mode + workspace fixtures.
- Consider reusing/deriving from `serializeBatchState` task construction logic to avoid future divergence between state and report semantics.
