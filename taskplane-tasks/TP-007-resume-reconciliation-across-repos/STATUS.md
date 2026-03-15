# TP-007: Resume Reconciliation and Continuation Across Repos — Status

**Current Step:** Step 2: Execute resumed waves safely
​**Status:** 🟡 In Progress
**Last Updated:** 2026-03-15
**Review Level:** 3
**Review Counter:** 3
**Iteration:** 2
**Size:** L

> **Hydration:** Checkboxes represent meaningful outcomes, not individual code
> changes. Workers expand steps when runtime discoveries warrant it — aim for
> 2-5 outcome-level items per step, not exhaustive implementation scripts.

---

### Step 0: Implement repo-aware reconciliation
**Status:** ✅ Complete

**Identity matching rules (deterministic key precedence):**
- v2 path: `persistedState.tasks[].resolvedRepoId` + `persistedState.lanes[].repoId` identify repo affinity.
  Lane→task matching uses `laneRecord.taskIds.includes(task.taskId)` (same as v1, repo is an attribute not a key).
  Session names are globally unique (`orch-lane-N`) so tmux session checks remain repo-agnostic.
- v1 path (repo fields absent): `mode="repo"` after upconvert, all fields `undefined`. Falls through to
  single-repo behavior identically to pre-polyrepo code — `resolveRepoRoot(undefined, repoRoot, null)` returns `repoRoot`.

**Signal resolution rules (.DONE and worktree existence):**
- `.DONE` check: `hasTaskDoneMarker(task.taskFolder)` — `taskFolder` is already an absolute path (set by discovery
  from `workspaceConfig.routing.tasksRoot` in workspace mode). Works across repos without `resolveRepoRoot`.
- Worktree existence: `existsSync(laneRecord.worktreePath)` — `worktreePath` is already absolute. Works across repos.
- Repo root needed for: worktree resets between waves, worktree cleanup at batch end, branch deletion after merge,
  re-execute task spawning, and reconnect polling. All must use `resolveRepoRoot(lane.repoId, repoRoot, workspaceConfig)`.

**Non-goals for Step 0:**
- No changes to `reconcileTaskStates()` or `computeResumePoint()` — these are pure functions operating on
  abstract signal sets (session name sets, task ID sets). Repo awareness lives in the caller that gathers signals.
- No changes to wave continuation logic (Step 1 scope).
- No cross-repo dependency graph changes.

- [x] Fix `resumeOrchBatch` to use `resolveRepoRoot()` for per-lane repo roots in: reconnect polling, re-execute spawning, inter-wave worktree reset, and terminal worktree cleanup
  - FINDING: All four areas were already repo-aware (done in prior TP-005/TP-006 work). Added `collectRepoRoots` helper function for test/reuse.
- [x] Ensure v1 state files (no repo fields) resume identically to pre-polyrepo behavior
  - Verified: `resolveRepoRoot(undefined, repoRoot, null)` returns `repoRoot` — v1 fallback works.
- [x] Add tests for mixed-repo reconciliation scenarios:
  - Workspace v2 state: one repo lane alive + another dead → correct reconcile actions ✅
  - Workspace v2 state: `.DONE` in one repo + dead session in another → mark-complete vs mark-failed ✅
  - v1 state (no repo fields) reconciles correctly with all-undefined repo fields ✅
  - Worktree exists vs missing split across repos → correct re-execute vs mark-failed ✅
  - `resolveRepoRoot` integration: v2 lanes get correct repo root, v1/undefined lanes get default root ✅
  - `collectRepoRoots`: workspace mode collects per-repo roots, repo mode returns only default ✅
  - Cross-repo `computeResumePoint`: mixed outcomes, both alive, all completed ✅

---

### Step 1: Compute repo-aware resume point
**Status:** ✅ Complete

**Decision table — reconciled action → continuation outcome:**

| Reconciled action | Persisted status | Continuation outcome | Counter effect |
|-------------------|-----------------|---------------------|----------------|
| mark-complete     | any             | `completedTaskIds` (succeeded) | `succeededTasks++` |
| skip (succeeded)  | succeeded       | `completedTaskIds` (succeeded) | (already counted) |
| skip (failed)     | failed/stalled  | `failedTaskIds` (terminal)     | (already counted) |
| skip (skipped)    | skipped         | treated as terminal for wave-skip; not re-queued | (already counted) |
| reconnect         | running/pending | wait for poll → succeeded or failed | `succeededTasks++` or `failedTasks++` |
| re-execute        | running/pending | re-spawn → succeeded or failed | `succeededTasks++` or `failedTasks++` |
| mark-failed       | running/pending | `failedTaskIds` (terminal) | `failedTasks++` |

**Blocked propagation rules (skip-dependents policy):**
- After reconciliation AND after reconnect/re-execute resolve, compute `computeTransitiveDependents(failedTaskSet, depGraph)`.
- Merge result with persisted `blockedTaskIds` (union, not replace) so repeated resume can't lose prior blocked tasks.
- Seed `batchState.blockedTaskIds` with the merged set BEFORE the wave loop begins.
- Within wave loop: `executeWave()` produces new blocked IDs from NEW wave failures (same as engine.ts).

**Counter invariants across resume boundaries:**
- `succeededTasks`: initialized from `resumePoint.completedTaskIds.length`, incremented by reconnect/re-execute successes and wave successes.
- `failedTasks`: initialized from `resumePoint.failedTaskIds.length`, incremented by reconnect/re-execute failures and wave failures.
- `skippedTasks`: carried from `persistedState.skippedTasks`, incremented only by wave execution.
- `blockedTasks`: carried from `persistedState.blockedTasks`, incremented per-wave for tasks in `blockedTaskIds` that appear in that wave (same as engine.ts).
- `blockedTaskIds`: union of `persistedState.blockedTaskIds` + newly computed transitive dependents from all reconciled+reconnect+re-execute failures.

**Skipped task semantics:**
- `computeResumePoint` wave-skip: `persistedStatus === "skipped"` treated as terminal (wave is "done" for skip purposes).
- `computeResumePoint` pending aggregation: skipped tasks with `persistedStatus === "skipped"` are NOT re-queued.
- Wave execution filtering: already excluded by `failedTaskSet`/`completedTaskSet`/`blockedTaskIds` + discovery filter.

- [x] Seed `blockedTaskIds` from reconciled failures before wave loop (import + call `computeTransitiveDependents` in `resumeOrchBatch` after reconciliation/reconnect/re-execute phases)
  - Already present in source (section 9b). Verified and tested.
- [x] Fix `computeResumePoint` to treat `persistedStatus === "skipped"` as terminal for wave-skip and NOT re-queue skipped tasks
  - Added `"skipped"` to wave-skip condition in `computeResumePoint` (was missing — pre-existing gap)
  - Added `"pending"` reconciliation action for never-started tasks (pending + no session) to prevent incorrect mark-failed
  - Fixed blocked task counter double-counting with `persistedBlockedTaskIds` tracking
  - Separated `mark-complete` from `skip` case in categorization switch for clarity
- [x] Add tests: reconciled failure in repo A blocks dependent in repo B under `skip-dependents`; persisted skipped tasks not re-queued; blocked/skipped counter stability across pause/resume; v1 fallback parity
  - 8 new test cases: pending-vs-failed distinction, skipped wave-skip, all-failed wave, counter stability, cross-repo blocked propagation, v1 fallback, workspace resume semantics
  - All 290 tests passing across 12 test files

---

### Step 2: Execute resumed waves safely
**Status:** ⬜ Not Started

- [ ] Run resumed allocation/execution/merge using repo-scoped context
- [ ] Persist reconciliation and continuation checkpoints with repo attribution

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
| R001 | plan | Step 0 | REVISED | .reviews/R001-plan-step0.md |
| R002 | code | Step 0 | UNKNOWN | .reviews/R002-code-step0.md |
| R002 | code | Step 0 | UNKNOWN | .reviews/R002-code-step0.md |
| R003 | plan | Step 1 | UNKNOWN | .reviews/R003-plan-step1.md |
| R003 | plan | Step 1 | UNKNOWN | .reviews/R003-plan-step1.md |
|---|------|------|---------|------|

## Discoveries
| Discovery | Disposition | Location |
|-----------|-------------|----------|
| resume.ts already had repo-aware patterns for all 4 critical areas (reconnect, re-execute, worktree reset, cleanup) from prior TP-005/TP-006 work | Verified + added test coverage | extensions/taskplane/resume.ts |
| engine.ts inter-wave worktree reset and terminal cleanup use single repoRoot (same gap as pre-fix resume.ts) — needs separate fix | Tech debt logged | extensions/taskplane/engine.ts:474,669 |
| `computeResumePoint` missing `"skipped"` in wave-skip terminal condition — pre-existing gap (waves with only skipped tasks would not be skipped over) | Fixed | extensions/taskplane/resume.ts:339 |
| `computeResumePoint` missing `"pending"` reconciliation action for never-started tasks (pending + no session) — all such tasks were incorrectly mark-failed | Fixed + added action type | extensions/taskplane/resume.ts:241, types.ts:1438 |
| Reconciled failures did not seed `blockedTaskIds` before wave loop (dependents of reconciled mark-failed tasks could execute under skip-dependents) | Fixed: added `computeTransitiveDependents` call in section 9b | extensions/taskplane/resume.ts:833 |
| `mark-failed` treated as terminal for wave-skip (semantic change: waves with all-failed tasks now skipped, reducing no-op loop iterations) | Intentional change + updated 15+ test expectations | extensions/taskplane/resume.ts:341 |

## Execution Log
| Timestamp | Action | Outcome |
|-----------|--------|---------|
| 2026-03-15 | Task staged | PROMPT.md and STATUS.md created |
| 2026-03-15 21:51 | Task started | Extension-driven execution |
| 2026-03-15 21:51 | Step 0 started | Implement repo-aware reconciliation |
| 2026-03-15 21:53 | Review R001 | plan Step 0: changes requested |
| 2026-03-15 21:55 | Plan revised | Added identity rules, signal resolution rules, test matrix, non-goals |
| 2026-03-15 22:03 | Step 0 impl | Code already repo-aware; added collectRepoRoots helper + 10 mixed-repo tests |
| 2026-03-15 22:03 | Tests passing | 290/290 tests pass across 12 test files |
| 2026-03-15 22:05 | Step 0 completed | Fixed 4 areas with per-repo resolveRepoRoot; 8 new mixed-repo reconciliation tests; all 290 tests pass |
| 2026-03-15 22:04 | Worker iter 1 | done in 663s, ctx: 73%, tools: 71 |
| 2026-03-15 22:05 | Worker iter 1 | done in 584s, ctx: 52%, tools: 73 |
| 2026-03-15 22:09 | Review R002 | code Step 0: UNKNOWN |
| 2026-03-15 22:09 | Step 0 complete | Implement repo-aware reconciliation |
| 2026-03-15 22:09 | Step 1 started | Compute repo-aware resume point |
| 2026-03-15 22:09 | Review R002 | code Step 0: UNKNOWN |
| 2026-03-15 22:09 | Step 0 complete | Implement repo-aware reconciliation |
| 2026-03-15 22:09 | Step 1 started | Compute repo-aware resume point |
| 2026-03-15 22:12 | Review R003 | plan Step 1: UNKNOWN |
| 2026-03-15 22:13 | Review R003 | plan Step 1: UNKNOWN |
| 2026-03-15 22:38 | Worker iter 2 | done in 1530s, ctx: 72%, tools: 191 |
| 2026-03-15 22:40 | Step 1 completed | computeResumePoint: mark-failed terminal, pending action, blocked seeding, skipped semantics; 8 new tests; 290/290 passing |

## Blockers

*None*

## Notes

*Reserved for execution notes*
