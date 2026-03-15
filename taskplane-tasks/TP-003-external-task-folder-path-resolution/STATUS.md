# TP-003: External Task Folder .DONE and STATUS Path Resolution — Status

**Current Step:** Step 2: Add regression coverage
​**Status:** 🟨 In Progress
**Last Updated:** 2026-03-15
**Review Level:** 2
**Review Counter:** 3
**Iteration:** 2
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
**Status:** ✅ Complete

- [x] Refactor `abort.ts::selectAbortTargetSessions` to use `resolveCanonicalTaskPaths` instead of manual repo-relative path translation (fixes invalid `taskFolderInWorktree` for external task folders)
- [x] Verify `writeWrapUpFiles` correctly resolves wrap-up signal file paths for external task folders (dependent on `taskFolderInWorktree` fix above — uses `taskFolderInWorktree` unchanged, works correctly with canonical resolved path)
- [x] Verify `buildLaneEnvVars` TASK_AUTOSTART handles external prompt paths correctly (uses absolute path as-is — no change needed, out of scope for completion probing)
- [x] Acceptance: monorepo tasks still resolve `taskFolderInWorktree` to `<worktree>/<relative-path>` — verified via `resolveCanonicalTaskPaths` case 1 logic
- [x] Acceptance: external task-root tasks resolve `taskFolderInWorktree` to absolute canonical path (not re-joined under worktree) — verified via `resolveCanonicalTaskPaths` case 2 logic
- [x] Acceptance: archive fallback works for both repo-contained and external task folders in abort flow — `resolveCanonicalTaskPaths` handles archive fallback for both branches

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
| R002 | code | Step 0 | UNKNOWN | .reviews/R002-code-step0.md |
| R002 | code | Step 0 | UNKNOWN | .reviews/R002-code-step0.md |
| R003 | plan | Step 1 | UNKNOWN | .reviews/R003-plan-step1.md |
| R003 | plan | Step 1 | UNKNOWN | .reviews/R003-plan-step1.md |
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
| 2026-03-15 07:30 | Worker iter 1 | done in 413s, ctx: 36%, tools: 63 |
| 2026-03-15 07:33 | Review R002 | code Step 0: UNKNOWN |
| 2026-03-15 07:33 | Step 0 complete | Introduce canonical task-path resolver |
| 2026-03-15 07:33 | Step 1 started | Fix completion probing |
| 2026-03-15 07:33 | Review R002 | code Step 0: UNKNOWN |
| 2026-03-15 07:33 | Step 0 complete | Introduce canonical task-path resolver |
| 2026-03-15 07:33 | Step 1 started | Fix completion probing |
| 2026-03-15 07:35 | Review R003 | plan Step 1: UNKNOWN |
| 2026-03-15 07:35 | Review R003 | plan Step 1: UNKNOWN |
| 2026-03-15 07:40 | Step 1 implementation | abort.ts refactored to use resolveCanonicalTaskPaths (committed ce69217); buildLaneEnvVars comment clarified (committed 9ab18c9); all 6 acceptance checkboxes verified |
| 2026-03-15 07:41 | Step 1 verified | Tests: 3 passing suites, 4 pre-existing failures (not related to TP-003 changes) |
| 2026-03-15 07:40 | Step 1 complete | Hydrated Step 1; refactored `abort.ts::selectAbortTargetSessions` to use `resolveCanonicalTaskPaths`; removed unused `resolve` import; verified monorepo + external + archive acceptance; 3 test suites pass (21 pre-existing failures unrelated) |
| 2026-03-15 07:40 | Worker iter 2 | done in 244s, ctx: 29%, tools: 33 |

## Blockers

*None*

## Notes

*Reserved for execution notes*
