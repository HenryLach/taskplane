# TP-004: Repo-Scoped Lane Allocation and Worktree Lifecycle — Status

**Current Step:** Step 0: Refactor lane allocation model
​**Status:** 🟡 In Progress
**Last Updated:** 2026-03-15
**Review Level:** 3
**Review Counter:** 1
**Iteration:** 1
**Size:** L

> **Hydration:** Checkboxes below must be granular — one per unit of work.
> Steps marked `⚠️ Hydrate` will be expanded by the worker.

---

### Step 0: Refactor lane allocation model
**Status:** ✅ Complete

**Lane identity contract:**
- [x] Add `repoId?: string` to `LaneAssignment` in types.ts
- [x] Add `repoId?: string` to `AllocatedLane` in types.ts
- [x] Add `repoId?: string` to `PersistedLaneRecord` in types.ts
- [x] Update `AllocatedLane.laneNumber` doc: globally unique across repos
- [x] `laneId` format: `lane-{N}` in repo mode, `{repoId}/lane-{N}` in workspace mode
- [x] `tmuxSessionName`: `{prefix}-lane-{N}` in repo mode, `{prefix}-{repoId}-lane-{N}` in workspace mode
- [x] In repo mode: `repoId` is `undefined`, all identifiers unchanged (backward compatible)

**Repo-grouped allocation:**
- [x] Add `RepoTaskGroup` interface in waves.ts
- [x] Add `groupTasksByRepo()` helper in waves.ts — deterministic grouping by resolvedRepoId
- [x] Add `generateLaneId()` helper — repo-aware lane ID generation
- [x] Add `generateTmuxSessionName()` helper — repo-aware TMUX session naming
- [x] Refactor `allocateLanes()` to group by repo, allocate per group, merge results
- [x] Deterministic ordering: repo groups sorted by repoId asc, then lane assignment within group
- [x] Tasks without resolvedRepoId grouped into single default group (repo mode fallback)
- [x] Each repo group gets independent max_lanes budget
- [x] Global lane numbers assigned sequentially across repo groups (repo A: 1..Na, repo B: Na+1..Na+Nb)
- [x] Clean up duplicate function definitions from prior iteration's partial work

**Downstream compatibility (deferred to Step 2):**
- [x] Document: `laneNumber` remains globally unique — engine.ts/resume.ts assumptions preserved
- [x] Document: `execution.ts` uses `lane.laneId`/`lane.tmuxSessionName` from AllocatedLane — auto-correct
- [x] Document: `abort.ts` session filtering uses `*-lane-*` pattern — workspace mode adds `*-{repoId}-lane-*` (Step 2)
- [x] Document: persistence serializes `repoId` via existing `PersistedLaneRecord.repoId` field

---

### Step 1: Make worktree operations repo-scoped
**Status:** ⬜ Not Started

- [ ] Ensure create/reset/remove worktree operations execute against each target repo root
- [ ] Keep deterministic ordering across repo groups and lane numbers

---

### Step 2: Update execution contracts
**Status:** ⬜ Not Started

- [ ] Thread repo-aware lane contracts through execution engine callbacks and state updates
- [ ] Preserve single-repo behavior when workspace mode is disabled

---

### Step 3: Testing & Verification
**Status:** ⬜ Not Started

- [ ] Unit/regression tests passing
- [ ] Targeted tests for changed modules passing
- [ ] All failures fixed
- [ ] CLI smoke checks passing

---

### Step 4: Documentation & Delivery
**Status:** ⬜ Not Started

- [ ] "Must Update" docs modified
- [ ] "Check If Affected" docs reviewed
- [ ] Discoveries logged
- [ ] `.DONE` created
- [ ] Archive and push

---

## Reviews
| # | Type | Step | Verdict | File |
| R001 | plan | Step 0 | changes-requested | .reviews/R001-plan-step0.md |
|---|------|------|---------|------|

## Discoveries
| Discovery | Disposition | Location |
|-----------|-------------|----------|
| Prior iteration left duplicate function definitions in waves.ts (3x groupTasksByRepo, 2x generateLaneId, 2x generateTmuxSessionName) | Fixed — clean rewrite of waves.ts from line 403 onward | waves.ts |
| Pre-existing test failures: 4 test files (3 tests) fail before this task's changes | Log — not caused by TP-004, not blocking | extensions/tests |

## Execution Log
| Timestamp | Action | Outcome |
|-----------|--------|---------|
| 2026-03-15 | Task staged | PROMPT.md and STATUS.md created |
| 2026-03-15 14:17 | Task started | Extension-driven execution |
| 2026-03-15 14:17 | Step 0 started | Refactor lane allocation model |
| 2026-03-15 14:20 | Review R001 | plan Step 0: changes-requested |
| 2026-03-15 | Step 0 implementation | Refactored allocateLanes(), added groupTasksByRepo/generateLaneId/generateTmuxSessionName, cleaned duplicates |
| 2026-03-15 | Tests validated | 4 pre-existing failures, 0 new failures from TP-004 changes |
| 2026-03-15 14:33 | Worker iter 1 | done in 781s, ctx: 64%, tools: 107 |

## Blockers

*None*

## Notes

**Downstream impact analysis (R001 finding #4):**
- `execution.ts`: Uses `lane.laneId`, `lane.tmuxSessionName`, `lane.worktreePath` from `AllocatedLane`. These fields are now repo-aware when `repoId` is set. No code changes needed — execution reads from the allocated lane object.
- `engine.ts`: Uses `laneNumber` as numeric key for lane-to-outcome mapping. Global uniqueness preserved → no changes needed.
- `persistence.ts`/`resume.ts`: `PersistedLaneRecord` already has `repoId?: string`. Serialization handles undefined gracefully.
- `abort.ts`: Session filtering uses tmux prefix pattern. Workspace mode sessions include repoId in the name, but the existing pattern `*-lane-*` still matches. May need refinement in Step 2.
- `messages.ts`: Uses `laneNumber` for display. No changes needed since laneNumber stays numeric and globally unique.
