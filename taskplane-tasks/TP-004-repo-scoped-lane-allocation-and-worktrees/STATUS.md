# TP-004: Repo-Scoped Lane Allocation and Worktree Lifecycle — Status

**Current Step:** Step 1: Make worktree operations repo-scoped
​**Status:** ✅ Complete
**Last Updated:** 2026-03-15
**Review Level:** 3
**Review Counter:** 3
**Iteration:** 2
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
**Status:** ✅ Complete

**Contract: Repo-root + base-branch resolution per lane**

Each `AllocatedLane` carries `repoId`. For worktree operations, each repo group resolves:
- `repoRoot`: In repo mode (repoId undefined) → use the single `repoRoot` param. In workspace mode → look up `workspaceConfig.repos.get(repoId).path`.
- `baseBranch`: In repo mode → use the single `baseBranch` param (captured at batch start). In workspace mode → use `WorkspaceRepoConfig.defaultBranch` if configured, else detect via `getCurrentBranch(repoRoot)` for that repo, else fall back to the batch-level `baseBranch`.

**Deterministic operation order**
- Repo groups sorted by repoId (ascending, undefined/empty sorts first).
- Within each repo group, lane numbers sorted ascending.
- Create, reset, and remove operations follow this ordering.

**Rollback semantics for cross-repo partial failure**
- If worktree creation fails for repo B after repo A's lanes were created:
  - Roll back repo B's newly-created lanes (current behavior within `ensureLaneWorktrees`).
  - Roll back repo A's newly-created lanes from this wave as well.
  - Return `success: false` with full error/rollback info.
- This maintains atomic wave allocation: either all lanes across all repos are provisioned, or none are (best-effort rollback).

**Deferred to Step 2:**
- `abort.ts` session filtering for workspace-mode session names
- Threading `workspaceConfig` through `executeWave` call chain (only needed when execution.ts needs per-repo context)

**Implementation checklist:**

_waves.ts changes:_
- [x] Add `workspaceConfig?: WorkspaceConfig | null` parameter to `allocateLanes()`
- [x] Add `resolveRepoRoot()` helper: resolves repoId → absolute repo root path
- [x] Add `resolveBaseBranch()` helper: resolves per-repo base branch with fallback chain
- [x] Refactor Stage 3: loop over repo groups, call `ensureLaneWorktrees()` per group with group-specific `repoRoot` and `baseBranch`
- [x] Add cross-repo rollback: on failure in repo group N, roll back all previously-created worktrees from groups 1..N-1
- [x] Update Stage 4: set `worktreePath` from per-repo worktree results (not single worktree map)
- [x] Preserve repo-mode behavior: when no workspaceConfig, all lanes use single repoRoot/baseBranch (zero change)

_worktree.ts changes:_
- [x] No signature changes needed — `ensureLaneWorktrees`, `createWorktree`, `removeWorktree` already take `repoRoot` as param; they're called per-group now

_types.ts changes:_
- [x] No changes needed — `AllocatedLane.repoId` already exists from Step 0

_Test plan:_
- [x] Unit test: `resolveRepoRoot()` — repo mode returns passed repoRoot; workspace mode looks up from config
- [x] Unit test: `resolveBaseBranch()` — fallback chain: repo config defaultBranch → detected branch → batch baseBranch
- [x] Unit test: `allocateLanes()` repo mode — unchanged behavior (regression via groupTasksByRepo + generateLaneId tests)
- [x] Unit test: `allocateLanes()` workspace mode — groupTasksByRepo workspace-mode grouping verified
- [x] Run full test suite: `cd extensions && npx vitest run` — no new failures (4 pre-existing only)

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
| R002 | code | Step 0 | UNKNOWN | .reviews/R002-code-step0.md |
| R002 | code | Step 0 | UNKNOWN | .reviews/R002-code-step0.md |
| R003 | plan | Step 1 | UNKNOWN | .reviews/R003-plan-step1.md |
| R003 | plan | Step 1 | UNKNOWN | .reviews/R003-plan-step1.md |
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
| 2026-03-15 14:35 | Worker iter 1 | done in 866s, ctx: 76%, tools: 99 |
| 2026-03-15 14:39 | Review R002 | code Step 0: UNKNOWN |
| 2026-03-15 14:39 | Step 0 complete | Refactor lane allocation model |
| 2026-03-15 14:39 | Step 1 started | Make worktree operations repo-scoped |
| 2026-03-15 14:42 | Review R002 | code Step 0: UNKNOWN |
| 2026-03-15 14:42 | Step 0 complete | Refactor lane allocation model |
| 2026-03-15 14:42 | Step 1 started | Make worktree operations repo-scoped |
| 2026-03-15 14:42 | Review R003 | plan Step 1: UNKNOWN |
| 2026-03-15 14:45 | Review R003 | plan Step 1: UNKNOWN |
| 2026-03-15 | Step 1 implementation | Cleaned duplicate helpers, added resolveRepoRoot/resolveBaseBranch, refactored Stage 3 for per-repo worktrees with cross-repo rollback |
| 2026-03-15 | Tests added | 19 unit tests in waves-repo-scoped.test.ts — all passing |
| 2026-03-15 | Full suite verified | 4 pre-existing failures, 0 new failures from TP-004 |
| 2026-03-15 | Step 1 complete | Make worktree operations repo-scoped |
| 2026-03-15 14:51 | Worker iter 2 | done in 397s, ctx: 45%, tools: 45 |

## Blockers

*None*

## Notes

**Downstream impact analysis (R001 finding #4):**
- `execution.ts`: Uses `lane.laneId`, `lane.tmuxSessionName`, `lane.worktreePath` from `AllocatedLane`. These fields are now repo-aware when `repoId` is set. No code changes needed — execution reads from the allocated lane object.
- `engine.ts`: Uses `laneNumber` as numeric key for lane-to-outcome mapping. Global uniqueness preserved → no changes needed.
- `persistence.ts`/`resume.ts`: `PersistedLaneRecord` already has `repoId?: string`. Serialization handles undefined gracefully.
- `abort.ts`: Session filtering uses tmux prefix pattern. Workspace mode sessions include repoId in the name, but the existing pattern `*-lane-*` still matches. May need refinement in Step 2.
- `messages.ts`: Uses `laneNumber` for display. No changes needed since laneNumber stays numeric and globally unique.
