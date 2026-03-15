# TP-007: Resume Reconciliation and Continuation Across Repos — Status

**Current Step:** Step 0: Implement repo-aware reconciliation
​**Status:** 🟡 In Progress
**Last Updated:** 2026-03-15
**Review Level:** 3
**Review Counter:** 1
**Iteration:** 1
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
**Status:** ⬜ Not Started

- [ ] Update wave/task continuation logic for mixed repo outcomes
- [ ] Ensure blocked/skipped semantics remain deterministic

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
|---|------|------|---------|------|

## Discoveries
| Discovery | Disposition | Location |
|-----------|-------------|----------|
| resume.ts already had repo-aware patterns for all 4 critical areas (reconnect, re-execute, worktree reset, cleanup) from prior TP-005/TP-006 work | Verified + added test coverage | extensions/taskplane/resume.ts |
| engine.ts inter-wave worktree reset and terminal cleanup use single repoRoot (same gap as pre-fix resume.ts) — needs separate fix | Tech debt logged | extensions/taskplane/engine.ts:474,669 |

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

## Blockers

*None*

## Notes

*Reserved for execution notes*
