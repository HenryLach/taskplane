# R005 — Plan Review (Step 2: Execute resumed waves safely)

## Verdict
**CHANGES REQUESTED**

## Reviewed artifacts
- `taskplane-tasks/TP-007-resume-reconciliation-across-repos/PROMPT.md`
- `taskplane-tasks/TP-007-resume-reconciliation-across-repos/STATUS.md`
- `extensions/taskplane/resume.ts`
- `extensions/taskplane/persistence.ts`
- `extensions/taskplane/merge.ts`
- `extensions/taskplane/engine.ts`
- `extensions/tests/orch-state-persistence.test.ts`

## Blocking findings

### 1) Step 2 plan is not hydrated yet
`STATUS.md` Step 2 still contains only prompt-level bullets (`STATUS.md:101-105`).

For a failure-path resume step, this is not implementation-ready. We need concrete, file-scoped checklist items (logic + persistence + tests), similar to the Step 1 decision table level of detail.

### 2) Step 2 plan does not account for unresolved blocked-counter behavior in resumed wave execution
The Step 1 code review issue is still open in runtime logic used by Step 2:
- `persistedBlockedTaskIds` copied from full persisted set (`resume.ts:524`)
- per-wave blocked counting excludes all of those IDs (`resume.ts:881-886`)

That can undercount `blockedTasks` when IDs were persisted before their wave was reached (pause/resume boundary). Since Step 2 is the resumed wave execution phase, the plan must explicitly include the counting contract and fix.

### 3) Checkpoint persistence plan does not define how repo attribution is preserved across resume writes
Current resume checkpoint flow persists right after reconciliation with no allocated lanes:
- `latestAllocatedLanes` initialized empty (`resume.ts:801`)
- immediate write at `"resume-reconciliation"` (`resume.ts:848`)

Persistence currently reconstructs records from the passed `lanes` argument:
- lane records are rebuilt from `lanes` only (`persistence.ts:703`)
- task records default `taskFolder: ""` and only get repo enrichment from `discovery.pending` (`persistence.ts:684`, `persistence.ts:229-237`)

Without an explicit preservation/merge strategy, resume checkpoints can lose lane/task metadata (including repo attribution) for non-pending tasks. That conflicts with Step 2’s requirement to persist reconciliation/continuation checkpoints with repo attribution.

### 4) Re-executed merge checkpoint indexing contract is undefined in the plan
Re-executed task merge uses synthetic wave index `0` (`resume.ts:746`) and calls `mergeWaveByRepo(..., 0, ...)` (`resume.ts:762`), while merge APIs are documented 1-indexed (`merge.ts:480`, `merge.ts:861`) and persisted merge records are normalized with `waveIndex: mr.waveIndex - 1` (`persistence.ts:723`).

This can emit persisted `waveIndex = -1` for that merge path unless intentionally handled. Step 2 plan should explicitly define expected semantics for re-exec merge progression and persistence.

## Required plan updates before implementation
1. Expand Step 2 in `STATUS.md` into concrete file-level items for:
   - resumed execution path (`resume.ts`),
   - persistence contract (`persistence.ts` and/or resume-side carry-forward),
   - tests (`orch-state-persistence.test.ts`, `orch-direct-implementation.test.ts`).
2. Add explicit blocked counter rules across pause/resume (what is “already counted” vs “count-on-wave”) and include the corresponding fix scope.
3. Define a metadata preservation strategy for resume checkpoints so lane/task repo attribution is not lost between writes.
4. Define re-exec merge indexing/persistence behavior (either normalize to a valid wave index or represent as a separate non-wave checkpoint type).
5. Add a Step 2 test matrix covering at minimum:
   - resumed mixed-repo wave execution + merge continuity,
   - checkpoint round-trip retaining `lanes[].repoId`, `tasks[].repoId`, `tasks[].resolvedRepoId`, and `taskFolder`,
   - blocked counter correctness across at least one pause/resume boundary,
   - re-exec merge persistence semantics (no invalid persisted wave index).

## Non-blocking note
- `resume.ts` has duplicated per-repo root collection loops (`resume.ts:1135`, `resume.ts:1170`) despite `collectRepoRoots()` helper (`resume.ts:40`). Consider using the helper for parity and drift prevention.
