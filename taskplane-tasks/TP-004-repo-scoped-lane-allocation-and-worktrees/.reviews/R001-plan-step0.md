# R001 — Plan Review (Step 0: Refactor lane allocation model)

## Verdict
**Changes requested**

## What I reviewed
- `taskplane-tasks/TP-004-repo-scoped-lane-allocation-and-worktrees/PROMPT.md`
- `taskplane-tasks/TP-004-repo-scoped-lane-allocation-and-worktrees/STATUS.md`
- Current implementation patterns in:
  - `extensions/taskplane/waves.ts`
  - `extensions/taskplane/types.ts`
  - `extensions/taskplane/worktree.ts`
  - `extensions/taskplane/execution.ts`
  - `extensions/taskplane/engine.ts`

## Findings

### 1) Missing implementation plan detail for Step 0 (blocking)
`STATUS.md` only repeats the two high-level Step 0 checkboxes from the prompt. There is no concrete file-by-file or contract-level plan to review (data model changes, function signature changes, ordering guarantees, compatibility behavior, tests).

Because this is a **Review Level 3 / large blast-radius** task, Step 0 needs explicit planning detail before implementation starts.

## Required plan updates before approval

1. **Define the repo-aware lane identity contract explicitly**
   - Proposed fields and ownership (at minimum for `AllocatedLane`):
     - `repoId`
     - lane-local number (`laneNumber`)
     - globally unique lane identity (e.g. `laneId = <repoId>/lane-<n>`)
     - tmux naming contract (repo dimension included to avoid collisions)
   - Confirm whether single-repo mode keeps legacy IDs (`lane-1`) or adopts normalized format.

2. **Define deterministic grouping and ordering rules** in `allocateLanes()`
   - How wave tasks are grouped by repo (`task.resolvedRepoId` in workspace mode, fallback in repo mode).
   - Deterministic repo group order (must be explicit, e.g., sorted repoId asc).
   - Deterministic lane ordering within each repo group.

3. **List Step 0 signature/model changes**
   - `waves.ts`: repo-grouped allocation API shape and return type guarantees.
   - `types.ts`: exact interfaces being extended/added (notably `AllocatedLane`, possibly `LaneAssignment` contracts used downstream).
   - Clarify what is intentionally deferred to Step 1/2 to avoid partial contract breaks.

4. **Call out cross-module impact risks from lane identity changes**
   Even if implementation is deferred to later steps, the Step 0 plan should acknowledge downstream consumers that assume `lane-<n>`/global numeric lane identity:
   - `execution.ts` and `engine.ts` logic keyed by `laneNumber`
   - session parsing/format assumptions
   - `abort.ts` session filtering currently expects `*-lane-*` suffix structure
   - persistence/resume lane records and tests

5. **Add concrete Step 0 tests to the plan**
   - New/updated tests for repo-group allocation determinism.
   - Coverage for mono-mode compatibility behavior.
   - Coverage for collision-safe lane/session IDs across two repos both using lane 1.

## Notes
The architecture direction in local polyrepo docs is consistent with this task (repo-scoped lanes + repo-aware IDs). The missing piece is a concrete, reviewable Step 0 execution plan in `STATUS.md`.
