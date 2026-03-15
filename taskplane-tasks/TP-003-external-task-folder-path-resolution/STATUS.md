# TP-003: External Task Folder .DONE and STATUS Path Resolution — Status

**Current Step:** Step 0: Introduce canonical task-path resolver
​**Status:** ✅ Complete
**Last Updated:** 2026-03-15
**Review Level:** 2
**Review Counter:** 1
**Iteration:** 1
**Size:** M

> **Hydration:** Checkboxes below must be granular — one per unit of work.
> Steps marked `⚠️ Hydrate` will be expanded by the worker.

---

### Step 0: Introduce canonical task-path resolver
**Status:** ✅ Complete

- [x] Define resolver contract: `resolveCanonicalTaskPaths(taskFolder, worktreePath, repoRoot)` — returns `{donePath, statusPath, taskFolderResolved}` with two-branch logic: (a) task folder inside repoRoot → `<worktree>/<relative>/...`, (b) task folder outside repoRoot → absolute `<taskFolder>/...` directly
- [x] Implement `resolveCanonicalTaskPaths` helper in `execution.ts` with archive fallback for both branches
- [x] Refactor `resolveTaskDonePath` to delegate to the new canonical resolver
- [x] Refactor `parseWorktreeStatusMd` to delegate to the new canonical resolver (eliminate duplicated translation logic)
- [x] Refactor `pollUntilTaskComplete` to use canonical resolver for both donePath and statusPath (was deriving statusPath via `dirname(donePath)`)
- [x] Identify abort.ts `selectAbortTargetSessions` as deferred call-site (Step 1 scope, noted here for traceability)
- [x] Verify monorepo compatibility: repo-contained task folders still resolve to `<worktree>/<relative-task-folder>/...`; archive fallback preserved; no behavior change for existing monorepo tasks (3 passing test suites confirmed)

---

### Step 1: Fix completion probing
**Status:** ⬜ Not Started

- [ ] Update .DONE resolution logic to probe correct canonical locations
- [ ] Update STATUS probing/monitor paths for external task roots

---

### Step 2: Add regression coverage
**Status:** ⬜ Not Started

- [ ] Add tests for external task folders outside repo root
- [ ] Verify no monorepo regressions in completion detection

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
| 2026-03-15 07:20 | Task started | Extension-driven execution |
| 2026-03-15 07:20 | Step 0 started | Introduce canonical task-path resolver |
| 2026-03-15 07:23 | Review R001 | plan Step 0: UNKNOWN |
| 2026-03-15 07:27 | Step 0 complete | Hydrated checkboxes per R001; implemented `resolveCanonicalTaskPaths`; refactored 3 call sites; 3 test suites pass (no regressions) |
| 2026-03-15 07:29 | Worker iter 1 | done in 357s, ctx: 34%, tools: 45 |

## Blockers

*None*

## Notes

*Reserved for execution notes*
