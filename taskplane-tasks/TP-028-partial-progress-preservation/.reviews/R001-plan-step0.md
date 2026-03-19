## Plan Review: Step 0: Preflight

### Verdict: REVISE

### Summary
The Step 0 checklist is directionally correct, but it is missing a couple of preflight reads that are necessary to execute TP-028 safely. In particular, it does not yet cover the mandatory Tier 2 context read and the actual state-serialization path that writes task outcomes into `.pi/batch-state.json`. Tightening these now will reduce rework in Steps 1–2.

### Issues Found
1. **[Severity: important]** — `STATUS.md:16-19` omits the required Tier 2 context read from `PROMPT.md:35-37` (`taskplane-tasks/CONTEXT.md`). Add an explicit Step 0 checkbox to read it and capture any active constraints/debt that could affect cleanup/state behavior.
2. **[Severity: important]** — Step 0 does not include `extensions/taskplane/persistence.ts`, but Step 2 requires persisting new outcome fields to batch state. The serialization contract is implemented in `extensions/taskplane/persistence.ts:675-742` (`serializeBatchState()` + `PersistedTaskRecord` mapping), so this must be part of preflight.
3. **[Severity: minor]** — `PROMPT.md:42` calls out `extensions/taskplane/naming.ts` as context, but Step 0 in `STATUS.md:16-19` does not explicitly include it. Since TP-028 introduces strict saved-branch naming variants, add this read to avoid ad-hoc naming logic.

### Missing Items
- Identify and note all cleanup call sites before implementation (`extensions/taskplane/engine.ts:726`, `extensions/taskplane/resume.ts:1410`, and force-cleanup paths at `engine.ts:557`, `resume.ts:1365`) so workspace/repo root handling is implemented consistently.
- Capture a preflight decision on compatibility with existing generic preservation behavior in `extensions/taskplane/worktree.ts` (`ensureBranchDeleted()` / `preserveBranch()` around lines ~797-1160) to avoid accidental success-path regressions.

### Suggestions
- Add a short "Preflight findings" note block in `STATUS.md` documenting insertion points for Step 1 and Step 2 before coding starts.
- During preflight, also check `extensions/taskplane/diagnostics.ts:200-203` (already has `partialProgress*` in `TaskExitDiagnostic`) to keep naming/semantics aligned with the new `LaneTaskOutcome` fields.
