# TP-003: External Task Folder .DONE and STATUS Path Resolution — Status

**Current Step:** Step 4: Documentation & Delivery
**Status:** 🟨 In Progress
**Last Updated:** 2026-03-15
**Review Level:** 2
**Review Counter:** 9
**Iteration:** 5
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
**Status:** ✅ Complete

- [x] Create `extensions/tests/external-task-path-resolution.test.ts` with 29 tests (commit 9629986)
- [x] Test `resolveCanonicalTaskPaths` Branch 1: repo-contained → worktree-relative (3 cases: basic, nested, no-files)
- [x] Test `resolveCanonicalTaskPaths` Branch 2: external → canonical absolute (4 cases: basic, deep-nested, prefix-substring edge, no-files)
- [x] Test `resolveCanonicalTaskPaths` Branch 3: archive fallback (3 cases: repo-contained, external, primary-preferred)
- [x] Test `resolveCanonicalTaskPaths` Branch 4: primary-path fallback when nothing exists (2 cases: repo, external)
- [x] Test `resolveTaskDonePath` delegation (3 cases: repo-contained, external, archive)
- [x] Test `parseWorktreeStatusMd` canonical path usage (4 cases: repo, external, missing-file, archive)
- [x] Test `selectAbortTargetSessions` abort-flow regression (6 cases: repo, external, archived-external, archived-repo, no-task, persisted-only)
- [x] Test monorepo completion detection end-to-end (4 cases: .DONE worktree, STATUS.md worktree, .DONE external, coexistence)
- [x] Verify no regressions: 3 existing suites pass (worktree-lifecycle, workspace-config, discovery-routing — 109 tests)

---

### Step 3: Testing & Verification
**Status:** ✅ Complete

- [x] Unit/regression tests passing — 139/139 tests pass across 5 suites (external-task-path-resolution, worktree-lifecycle, workspace-config, discovery-routing, execution-path-resolution)
- [x] Targeted tests for changed modules passing — 29/29 TP-003 tests pass; all 5 passing suites green
- [x] All failures fixed — 22 pre-existing failures in 4 other suites confirmed unrelated (identical failures on pre-TP-003 commit 63f99e1)
- [x] CLI smoke checks passing — `taskplane help` and `taskplane doctor` both run correctly

---

### Step 4: Documentation & Delivery
**Status:** 🟨 In Progress

- [x] Update `.pi/local/docs/taskplane/polyrepo-implementation-plan.md` with final canonical path-resolution strategy and fallback behavior
- [x] Review `docs/explanation/waves-lanes-and-worktrees.md`; reviewed, no update required — doc describes high-level wave/lane/worktree concepts and does not cover internal path-resolution mechanics; TP-003 changes are implementation-internal and do not alter operator-facing behavior
- [x] Record discoveries in STATUS.md Discoveries table (or explicitly note none)
- [ ] Create `.DONE` in `taskplane-tasks/TP-003-external-task-folder-path-resolution/`
- [ ] Confirm archive is task-runner-managed (no manual action needed)

---

## Reviews
| # | Type | Step | Verdict | File |
| R001 | plan | Step 0 | UNKNOWN | .reviews/R001-plan-step0.md |
| R001 | plan | Step 0 | UNKNOWN | .reviews/R001-plan-step0.md |
| R002 | code | Step 0 | UNKNOWN | .reviews/R002-code-step0.md |
| R002 | code | Step 0 | UNKNOWN | .reviews/R002-code-step0.md |
| R003 | plan | Step 1 | UNKNOWN | .reviews/R003-plan-step1.md |
| R003 | plan | Step 1 | UNKNOWN | .reviews/R003-plan-step1.md |
| R004 | code | Step 1 | UNKNOWN | .reviews/R004-code-step1.md |
| R004 | code | Step 1 | UNKNOWN | .reviews/R004-code-step1.md |
| R005 | plan | Step 2 | UNKNOWN | .reviews/R005-plan-step2.md |
| R005 | plan | Step 2 | UNKNOWN | .reviews/R005-plan-step2.md |
| R006 | code | Step 2 | UNKNOWN | .reviews/R006-code-step2.md |
| R006 | code | Step 2 | UNKNOWN | .reviews/R006-code-step2.md |
| R007 | plan | Step 3 | UNKNOWN | .reviews/R007-plan-step3.md |
| R007 | plan | Step 3 | UNKNOWN | .reviews/R007-plan-step3.md |
| R008 | code | Step 3 | UNKNOWN | .reviews/R008-code-step3.md |
| R009 | plan | Step 4 | REVISE | .reviews/R009-plan-step4.md |
| R008 | code | Step 3 | UNKNOWN | .reviews/R008-code-step3.md |
| R009 | plan | Step 4 | APPROVE | .reviews/R009-plan-step4.md |
|---|------|------|---------|------|

## Discoveries
| Discovery | Disposition | Location |
|-----------|-------------|----------|
| 22 pre-existing test failures in 4 suites (orch-pure-functions, orch-state-persistence, task-runner-orchestration, orch-direct-implementation) caused by monolith→module split, not TP-003 | Tech debt — tracked in existing backlog | `extensions/tests/` |
| `buildLaneEnvVars` already handles external prompt paths correctly via absolute paths — no change needed | No action | `extensions/taskplane/execution.ts` |

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
| 2026-03-15 07:40 | Worker iter 2 | done in 336s, ctx: 34%, tools: 55 |
| 2026-03-15 07:43 | Review R004 | code Step 1: UNKNOWN |
| 2026-03-15 07:43 | Step 1 complete | Fix completion probing |
| 2026-03-15 07:43 | Step 2 started | Add regression coverage |
| 2026-03-15 07:43 | Review R004 | code Step 1: UNKNOWN |
| 2026-03-15 07:43 | Step 1 complete | Fix completion probing |
| 2026-03-15 07:43 | Step 2 started | Add regression coverage |
| 2026-03-15 07:45 | Review R005 | plan Step 2: UNKNOWN |
| 2026-03-15 07:51 | Step 2 implementation | Created external-task-path-resolution.test.ts with 29 tests covering 4 resolution branches + abort-flow regression + monorepo regression (commit 9629986) |
| 2026-03-15 07:51 | Step 2 verified | 29/29 new tests pass; 109/109 existing tests pass (3 suites, no regressions) |
| 2026-03-15 07:51 | Step 2 complete | Add regression coverage |
| 2026-03-15 07:46 | Review R005 | plan Step 2: UNKNOWN |
| 2026-03-15 07:50 | Step 2 implementation | Added execution-path-resolution.test.ts with 5 test categories (monorepo, external, archive fallback, delegation, edge cases); all pass; 4 pre-existing suite failures confirmed unrelated (committed 40c5b98) |
| 2026-03-15 07:50 | Step 2 complete | Add regression coverage |
| 2026-03-15 07:52 | Worker iter 3 | done in 328s, ctx: 28%, tools: 46 |
| 2026-03-15 07:52 | Worker iter 3 | done in 418s, ctx: 34%, tools: 49 |
| 2026-03-15 07:54 | Review R006 | code Step 2: UNKNOWN |
| 2026-03-15 07:54 | Step 2 complete | Add regression coverage |
| 2026-03-15 07:54 | Step 3 started | Testing & Verification |
| 2026-03-15 07:55 | Review R006 | code Step 2: UNKNOWN |
| 2026-03-15 07:55 | Step 2 complete | Add regression coverage |
| 2026-03-15 07:55 | Step 3 started | Testing & Verification |
| 2026-03-15 07:57 | Review R007 | plan Step 3: UNKNOWN |
| 2026-03-15 07:58 | Step 3 verified | 139/139 tests pass (5 suites); 29/29 TP-003 tests pass; 22 pre-existing failures confirmed on pre-TP-003 commit; CLI smoke OK |
| 2026-03-15 07:58 | Step 3 complete | Testing & Verification |
| 2026-03-15 07:58 | Review R007 | plan Step 3: UNKNOWN |
| 2026-03-15 08:00 | Worker iter 4 | done in 180s, ctx: 12%, tools: 15 |
| 2026-03-15 08:01 | Worker iter 4 | done in 199s, ctx: 15%, tools: 19 |
| 2026-03-15 08:04 | Review R008 | code Step 3: UNKNOWN |
| 2026-03-15 08:04 | Step 3 complete | Testing & Verification |
| 2026-03-15 08:04 | Step 4 started | Documentation & Delivery |
| 2026-03-15 08:05 | Review R009 | plan Step 4: REVISE |
| 2026-03-15 08:05 | Review R008 | code Step 3: UNKNOWN |
| 2026-03-15 08:05 | Step 3 complete | Testing & Verification |
| 2026-03-15 08:05 | Step 4 started | Documentation & Delivery |
| 2026-03-15 08:06 | Review R009 | plan Step 4: APPROVE |

## Blockers

*None*

## Notes

*Reserved for execution notes*
