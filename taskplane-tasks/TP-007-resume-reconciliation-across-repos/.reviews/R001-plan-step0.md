# R001 — Plan Review (Step 0: Implement repo-aware reconciliation)

## Verdict
**Changes requested**

## Reviewed artifacts
- `taskplane-tasks/TP-007-resume-reconciliation-across-repos/PROMPT.md`
- `taskplane-tasks/TP-007-resume-reconciliation-across-repos/STATUS.md`
- `extensions/taskplane/resume.ts`
- `extensions/taskplane/persistence.ts`
- `extensions/taskplane/types.ts`
- `extensions/taskplane/waves.ts`
- `extensions/taskplane/abort.ts`
- `extensions/tests/orch-state-persistence.test.ts`
- `extensions/tests/orch-direct-implementation.test.ts`
- `.pi/local/docs/taskplane/polyrepo-support-spec.md`
- `.pi/local/docs/taskplane/polyrepo-implementation-plan.md`

## Blocking findings

### 1) Step 0 plan is not hydrated yet
`STATUS.md` Step 0 is still only prompt-level bullets (`STATUS.md:20-22`), without concrete implementation units.

Given TP-007 is failure-path critical (`/orch-resume` recovery), Step 0 needs explicit file-level plan items before coding.

### 2) Repo-aware identity matching contract is not defined
Current resume reconciliation relies on exact `task.sessionName` matching (`resume.ts:385-388`, `resume.ts:147`) and task→lane lookup via `lanes.find(...taskIds.includes(...))` (`resume.ts:402-403`).

Step 0 requires a concrete identity strategy using persisted repo-aware fields (`PersistedTaskRecord.repoId/resolvedRepoId`, `PersistedLaneRecord.repoId` in `types.ts:1221-1293`) plus deterministic fallback when those fields are absent (v1).

Without this contract, mixed-repo sessions can be misclassified as reconnect/failed inconsistently.

### 3) Repo-root-aware live signal resolution is not planned
The design docs explicitly note repo roots should be resolved at resume time from workspace config + `repoId` (polyrepo support spec §11; implementation plan WS-F design note).

Current Step 0 flow checks:
- `.DONE` via persisted `task.taskFolder` only (`resume.ts:393-396`)
- worktree existence via persisted `lane.worktreePath` only (`resume.ts:401-404`)

The plan must state how repo-specific roots are derived/validated for reconciliation (not just persisted absolute paths), especially in workspace mode.

### 4) v1 fallback rules are mentioned but not operationalized
Prompt requires “v1 fallback when repo fields are absent,” but Step 0 does not define exact fallback precedence.

Need explicit behavior for at least:
- `mode="repo"` / schema v1 (no repo fields)
- v2 records with missing optional repo fields
- mixed records where `task.resolvedRepoId` and `lane.repoId` disagree or are unavailable

### 5) Test plan is underspecified for mixed-repo reconciliation
Step 0 says “add tests,” but no matrix is defined.

Current resume-focused test sections are single-repo shaped (`orch-state-persistence.test.ts:2408-2555`) and do not lock mixed-repo reconciliation behavior. `orch-direct-implementation.test.ts` also has no repo-aware reconciliation assertions (`lines 31-94`).

## Required plan updates before implementation
1. Hydrate Step 0 in `STATUS.md` into concrete checklist items per file (`resume.ts`, `persistence.ts`, `orch-state-persistence.test.ts`, `orch-direct-implementation.test.ts`).
2. Define a canonical reconciliation identity key and match precedence (repo-aware first; v1/session-name fallback second), including deterministic tie-breaks.
3. Define repo-root signal resolution strategy for `.DONE` and worktree checks using repo context (`resolveRepoRoot(...)` pathing) and fallback behavior.
4. Specify mismatch/error handling rules for ambiguous or inconsistent persisted records (missing lane, unknown repoId, conflicting repo attribution).
5. Add a Step 0 test matrix with explicit scenarios:
   - mixed repos with overlapping local lane numbers,
   - alive/dead session combinations across repos,
   - `.DONE`/worktree presence split by repo,
   - v1 compatibility fallback (no repo fields),
   - regression for repo mode unchanged behavior.

## Non-blocking note
- `STATUS.md` execution log has duplicate start rows (`STATUS.md:75-78`). Consider cleanup for operator clarity.
