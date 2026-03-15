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
**Status:** 🟨 In Progress

**Lane identity contract (R001 finding #2):**
- [x] Add `repoId?: string` to `LaneAssignment` in types.ts
- [x] Add `repoId?: string` to `AllocatedLane` in types.ts
- [x] Add `repoId?: string` to `PersistedLaneRecord` in types.ts
- [x] Lane numbers remain globally unique (1-indexed across all repos)
- [x] `laneId` format stays `lane-{N}` (repo mode); `{repoId}/lane-{N}` (workspace mode)
- [x] In repo mode: `repoId` is `undefined` (no-regression)

**Repo-grouped allocation (R001 findings #1, #4):**
- [x] Add `groupTasksByRepo()` helper in waves.ts — deterministic grouping by resolvedRepoId
- [x] Update `assignTasksToLanes()` to accept and propagate repoId
- [x] Update `allocateLanes()` to group by repo, allocate per group, merge results
- [x] Deterministic ordering: repo groups sorted by repoId, then lane assignment within group
- [x] Tasks without resolvedRepoId grouped into single default group (repo mode fallback)

**Downstream compatibility path (R001 finding #3):**
- [x] Document which consumers are updated now vs deferred to Step 2
- [x] Ensure `laneNumber` uniqueness assumptions in engine.ts / resume.ts are preserved

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
| R001 | plan | Step 0 | UNKNOWN | .reviews/R001-plan-step0.md |
| R001 | plan | Step 0 | UNKNOWN | .reviews/R001-plan-step0.md |
|---|------|------|---------|------|

## Discoveries
| Discovery | Disposition | Location |
|-----------|-------------|----------|

## Execution Log
| Timestamp | Action | Outcome |
|-----------|--------|---------|
| 2026-03-15 | Task staged | PROMPT.md and STATUS.md created |
| 2026-03-15 14:17 | Task started | Extension-driven execution |
| 2026-03-15 14:17 | Step 0 started | Refactor lane allocation model |
| 2026-03-15 14:17 | Task started | Extension-driven execution |
| 2026-03-15 14:17 | Step 0 started | Refactor lane allocation model |
| 2026-03-15 14:20 | Review R001 | plan Step 0: UNKNOWN |
| 2026-03-15 14:21 | Review R001 | plan Step 0: UNKNOWN |

## Blockers

*None*

## Notes

*Reserved for execution notes*
