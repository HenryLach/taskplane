# TP-005: Repo-Scoped Merge Orchestration with Explicit Partial Outcomes — Status

**Current Step:** Step 0: Partition merge flow by repo
​**Status:** ✅ Complete
**Last Updated:** 2026-03-15
**Review Level:** 3
**Review Counter:** 1
**Iteration:** 1
**Size:** L

> **Hydration:** Checkboxes below must be granular — one per unit of work.
> Steps marked `⚠️ Hydrate` will be expanded by the worker.

---

### Step 0: Partition merge flow by repo
**Status:** ✅ Complete

**Contract:** Lanes are grouped by `repoId` (from `AllocatedLane.repoId`). Groups are sorted alphabetically by repoId (undefined → `""` sorts first, preserving mono-repo behavior). Within each group, the existing fewest-files-first or sequential order is preserved. Each group's merge runs against `resolveRepoRoot(repoId)` with `resolveBaseBranch(repoId)`. Mono-repo mode (no repoId) produces one group with `repoId=undefined`, preserving current behavior exactly.

**Failure semantics (Step 0):** On per-repo failure, continue merging remaining repos (best-effort). Aggregate `MergeWaveResult.status`: if ALL repos succeed → `"succeeded"`, if SOME fail → `"partial"`, if ALL fail → `"failed"`. `failedLane` / `failureReason` are set to the first failure across all repos (deterministic due to sorted repo group order).

- [x] Define repo-scoped merge contract: grouping key, ordering, fallback (documented above)
- [x] Add `groupMergeableLanesByRepo()` helper in `merge.ts`
- [x] Refactor `mergeWave()` to iterate per-repo groups with correct `repoRoot` / `baseBranch`
- [x] Aggregate per-repo merge outcomes into single `MergeWaveResult`
- [x] Update engine.ts `/orch` call site to pass `workspaceConfig` to `mergeWave()`
- [x] Update resume.ts `/orch-resume` call sites (both re-exec merge and wave merge) to pass `workspaceConfig`
- [x] Add unit tests: multi-repo grouping determinism
- [x] Add unit tests: mono-repo no-regression (single group, same behavior)
- [x] Add unit tests: deterministic failure aggregation across repos
- [x] Fix messages.ts misleading "into develop" text

---

### Step 1: Update outcome modeling
**Status:** ⬜ Not Started

- [ ] Extend merge result models to include repo attribution
- [ ] Emit explicit partial-success summaries when repos diverge in outcome

---

### Step 2: Harden failure behavior
**Status:** ⬜ Not Started

- [ ] Ensure pause/abort policies remain deterministic with repo-scoped failures
- [ ] Preserve debug artifacts needed for manual intervention

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
| R001 | plan | Step 0 | REVISE | .reviews/R001-plan-step0.md |
|---|------|------|---------|------|

## Discoveries
| Discovery | Disposition | Location |
|-----------|-------------|----------|

## Execution Log
| Timestamp | Action | Outcome |
|-----------|--------|---------|
| 2026-03-15 | Task staged | PROMPT.md and STATUS.md created |
| 2026-03-15 16:49 | Task started | Extension-driven execution |
| 2026-03-15 16:49 | Step 0 started | Partition merge flow by repo |
| 2026-03-15 16:49 | Task started | Extension-driven execution |
| 2026-03-15 16:49 | Step 0 started | Partition merge flow by repo |
| 2026-03-15 16:52 | Review R001 | plan Step 0: UNKNOWN |
| 2026-03-15 16:53 | Review R001 | plan Step 0: REVISE |
| 2026-03-15 17:04 | Step 0 implemented | groupLanesByRepo + mergeWaveByRepo, engine/resume updated, tests pass (216/216) |

## Blockers

*None*

## Notes

*Reserved for execution notes*
