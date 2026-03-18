# TP-021: Batch-Scoped Worktree Containers — Status

**Current Step:** Step 0: Preflight
**Status:** 🟡 In Progress
**Last Updated:** 2026-03-18
**Review Level:** 2
**Review Counter:** 1
**Iteration:** 1
**Size:** M

---

### Step 0: Preflight
**Status:** ✅ Complete

- [x] Read `worktree.ts` — understand all worktree functions and their signatures
- [x] Read `waves.ts` — understand `allocateLanes()` worktree creation
- [x] Read `engine.ts` — understand worktree reset and cleanup flows
- [x] Read `merge.ts` — understand merge worktree creation
- [x] Read `resume.ts` — understand worktree listing/cleanup in resume flows (R001)
- [x] Read relevant test files — `worktree-lifecycle.test.ts`, `naming-collision.test.ts` for old naming patterns (R001)
- [x] Grep-based caller inventory: log all callers of `generateWorktreePath`, `listWorktrees`, `removeAllWorktrees` in STATUS.md Discoveries (R001)
- [x] Note transition behavior needs for `listWorktrees()` old+new naming support (R001)

---

### Step 1: Refactor Worktree Path Generation
**Status:** ⬜ Not Started

- [ ] Update `generateWorktreePath()` to `{basePath}/{opId}-{batchId}/lane-{N}`
- [ ] Add `generateMergeWorktreePath()` → `{basePath}/{opId}-{batchId}/merge`
- [ ] Update `CreateWorktreeOptions` and `createWorktree()` for new paths
- [ ] Ensure container directory creation

---

### Step 2: Update Worktree Listing and Cleanup
**Status:** ⬜ Not Started

- [ ] Update `listWorktrees()` for new nested structure
- [ ] Update `removeAllWorktrees()` to remove batch container
- [ ] Update `removeWorktree()` and `forceCleanupWorktree()` if needed

---

### Step 3: Update All Callers
**Status:** ⬜ Not Started

- [ ] Update `allocateLanes()` in `waves.ts`
- [ ] Update `engine.ts` worktree reset and cleanup
- [ ] Update `merge.ts` to use `generateMergeWorktreePath()`
- [ ] Update `execution.ts` if needed

---

### Step 4: Testing & Verification
**Status:** ⬜ Not Started

- [ ] Unit tests passing
- [ ] Path generation verified
- [ ] Subdirectory and sibling modes verified
- [ ] Listing and cleanup verified
- [ ] All failures fixed

---

### Step 5: Documentation & Delivery
**Status:** ⬜ Not Started

- [ ] Discoveries logged
- [ ] `.DONE` created

---

## Reviews

| # | Type | Step | Verdict | File |
| R001 | plan | Step 0 | REVISE | .reviews/R001-plan-step0.md |
| R001 | plan | Step 0 | REVISE | .reviews/R001-plan-step0.md |
|---|------|------|---------|------|

---

## Discoveries

| Discovery | Disposition | Location |
|-----------|-------------|----------|
| `generateWorktreePath()` runtime callers: `createWorktree()` in `worktree.ts:208` | In scope (Step 1) | `worktree.ts` |
| `generateWorktreePath()` test callers: `worktree-lifecycle.test.ts` (5 calls), `naming-collision.test.ts` (9 calls), `orch-pure-functions.test.ts` (table-driven), `polyrepo-regression.test.ts` | In scope (Step 4) | tests |
| `listWorktrees()` runtime callers: `engine.ts:484` (reset loop), `resume.ts:1295` (reset loop), `worktree.ts:1219` (ensureLaneWorktrees), `worktree.ts:1320` (removeAllWorktrees) | In scope (Step 2-3) | engine/resume/worktree |
| `removeAllWorktrees()` runtime callers: `engine.ts:679` (Phase 3 cleanup), `resume.ts:1323` (cleanup), `waves.ts:1076` (rollback in allocateLanes) | In scope (Step 3) | engine/resume/waves |
| `resume.ts` uses both `listWorktrees()` and `removeAllWorktrees()` — same patterns as `engine.ts` | Add to Step 3 scope | `resume.ts:1295,1323` |
| `merge.ts` creates merge worktree ad-hoc: `join(repoRoot, ".worktrees", "merge-workspace-{opId}")` at line ~mergeWave | In scope (Step 3) | `merge.ts` |
| `execution.ts` does NOT directly call any of these 3 functions — uses `AllocatedLane.worktreePath` | No change needed | `execution.ts` |
| `listWorktrees()` backward compat: currently matches `{prefix}-{opId}-{N}` basename. New structure nests inside `{opId}-{batchId}/lane-{N}` — listing must scan container dirs | Transition risk (Step 2) | `worktree.ts` |
| No existing `worktree-lifecycle.test.ts` or `naming-collision.test.ts` fixtures encode old path patterns — tests use `createWorktree` dynamically | Low transition risk | tests |
| `generateWorktreePath()` callers: `worktree.ts:208` (createWorktree), `naming-collision.test.ts` (×7), `worktree-lifecycle.test.ts` (×3) | Runtime: worktree.ts:208 needs batchId param. Tests: need path assertion updates. | worktree.ts, tests |
| `listWorktrees()` callers: `engine.ts:484` (reset loop), `resume.ts:1295` (reset loop), `worktree.ts:1219` (ensureLaneWorktrees), `worktree.ts:1320` (removeAllWorktrees), `naming-collision.test.ts:368+` (pattern tests), `worktree-lifecycle.test.ts` (×5 integration) | Runtime: engine.ts, resume.ts, worktree.ts need new nested-container pattern support. Tests: regex pattern tests need migration. | engine.ts, resume.ts, worktree.ts, tests |
| `removeAllWorktrees()` callers: `engine.ts:679` (Phase 3 cleanup), `resume.ts:1323` (cleanup), `waves.ts:1076` (defensive rollback), `naming-collision.test.ts:451+` (pattern tests), `worktree-lifecycle.test.ts` (×2 integration) | Runtime: all callers pass through listWorktrees so no direct change. But need container directory removal after worktree removal. | engine.ts, resume.ts, waves.ts |
| merge.ts creates ad-hoc merge worktree at `join(repoRoot, ".worktrees", "merge-workspace-{opId}")` (line 572) — should become `{basePath}/{opId}-{batchId}/merge` | Step 3 change needed | merge.ts:572 |
| `resume.ts` calls `listWorktrees()` at line 1295 and `removeAllWorktrees()` at line 1323 — confirmed as runtime-critical callers | Must update in Step 3 (R001 item) | resume.ts |
| `listWorktrees()` currently matches `{prefix}-{opId}-{N}` basename pattern. New pattern must match `lane-{N}` inside `{opId}-{batchId}/` containers. Transition: must support both old flat pattern AND new nested pattern. | Step 2 implementation concern | worktree.ts |
| Tests in `naming-collision.test.ts` assert `basename == "taskplane-wt-alice-1"` etc. These will break with new naming. Tests in `worktree-lifecycle.test.ts` assert `generateWorktreePath` output format. Both need migration in Step 4. | Test migration needed | tests |

---

## Execution Log

| Timestamp | Action | Outcome |
|-----------|--------|---------|
| 2026-03-18 | Task staged | PROMPT.md and STATUS.md created |
| 2026-03-18 11:40 | Task started | Extension-driven execution |
| 2026-03-18 11:40 | Step 0 started | Preflight |
| 2026-03-18 11:40 | Task started | Extension-driven execution |
| 2026-03-18 11:40 | Step 0 started | Preflight |
| 2026-03-18 11:42 | Review R001 | plan Step 0: REVISE |
| 2026-03-18 11:42 | Review R001 | plan Step 0: REVISE |

---

## Blockers

*None*

---

## Notes

*Reserved for execution notes*
