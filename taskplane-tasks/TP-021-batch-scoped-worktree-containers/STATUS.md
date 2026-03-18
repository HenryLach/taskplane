# TP-021: Batch-Scoped Worktree Containers — Status

**Current Step:** Step 2: Update Worktree Listing and Cleanup
**Status:** 🟡 In Progress
**Last Updated:** 2026-03-18
**Review Level:** 2
**Review Counter:** 5
**Iteration:** 3
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
**Status:** ✅ Complete

- [x] Add `generateBatchContainerPath()` shared helper: `{basePath}/{opId}-{batchId}` using `resolveWorktreeBasePath()` (preserves sibling/subdirectory mode)
- [x] Update `generateWorktreePath()` signature to include `batchId`, output `{basePath}/{opId}-{batchId}/lane-{N}` via the shared helper
- [x] Add `generateMergeWorktreePath()` using the same shared helper: `{basePath}/{opId}-{batchId}/merge` (config-aware, base-path-consistent)
- [x] Verify `CreateWorktreeOptions` already has `batchId` (no schema change needed — R003 item)
- [x] Update `createWorktree()` to pass `batchId` to `generateWorktreePath()` and ensure container dir is auto-created (`mkdirSync recursive`)
- [x] R004-1: Add transitional matching in `listWorktrees()` for new nested `lane-{N}` pattern inside `{opId}-{batchId}/` containers (while retaining legacy flat pattern matching)
- [x] R004-2: Move `ensureBatchContainerDir()` call in `createWorktree()` to after pre-checks (before `git worktree add`), preventing empty container dirs on validation failure

---

### Step 2: Update Worktree Listing and Cleanup
**Status:** ✅ Complete

- [x] Add optional `batchId` parameter to `listWorktrees()` — when provided, scope discovery to only `{opId}-{batchId}/lane-{N}` entries (batch isolation); when omitted, retain current all-operator behavior (backward compat). Preserve legacy flat-path matching for transition support.
- [x] Add optional `batchId` parameter to `removeAllWorktrees()` — pass through to `listWorktrees()` for batch-scoped cleanup. After removing worktrees, attempt to remove the empty batch container directory (only if it exists and is empty; never force-remove non-empty containers).
- [x] Add `removeBatchContainerIfEmpty()` helper — safely removes `{basePath}/{opId}-{batchId}/` only when empty. Used by `removeAllWorktrees()` after per-worktree removals. No-op on partial failure (non-empty dir).
- [x] Update `forceCleanupWorktree()` to also attempt container cleanup after force-removing a worktree (per-container, empty-only check)
- [x] Add Step 3 dependency note: `resume.ts` must be updated when list/remove signatures change (R005 item)

---

### Step 3: Update All Callers
**Status:** ⬜ Not Started

- [ ] Update `allocateLanes()` in `waves.ts`
- [ ] Update `engine.ts` worktree reset and cleanup
- [ ] Update `merge.ts` to use `generateMergeWorktreePath()`
- [ ] Update `execution.ts` if needed
- [ ] Update `resume.ts` callers of `listWorktrees()` and `removeAllWorktrees()` to pass `batchId` for batch-scoped operations (R005 dependency)

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
| R002 | code | Step 0 | APPROVE | .reviews/R002-code-step0.md |
| R002 | code | Step 0 | APPROVE | .reviews/R002-code-step0.md |
| R003 | plan | Step 1 | APPROVE | .reviews/R003-plan-step1.md |
| R003 | plan | Step 1 | REVISE | .reviews/R003-plan-step1.md |
| R004 | code | Step 1 | REVISE | .reviews/R004-code-step1.md |
| R004 | code | Step 1 | REVISE | .reviews/R004-code-step1.md |
| R005 | plan | Step 2 | REVISE | .reviews/R005-plan-step2.md |
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
| 2026-03-18 11:45 | Worker iter 1 | done in 188s, ctx: 40%, tools: 37 |
| 2026-03-18 11:46 | Worker iter 1 | done in 225s, ctx: 55%, tools: 46 |
| 2026-03-18 11:47 | Review R002 | code Step 0: APPROVE |
| 2026-03-18 11:47 | Step 0 complete | Preflight |
| 2026-03-18 11:47 | Step 1 started | Refactor Worktree Path Generation |
| 2026-03-18 11:47 | Review R002 | code Step 0: APPROVE |
| 2026-03-18 11:47 | Step 0 complete | Preflight |
| 2026-03-18 11:47 | Step 1 started | Refactor Worktree Path Generation |
| 2026-03-18 11:49 | Review R003 | plan Step 1: APPROVE |
| 2026-03-18 11:50 | Review R003 | plan Step 1: REVISE |
| 2026-03-18 11:54 | Worker iter 2 | done in 230s, ctx: 26%, tools: 33 |
| 2026-03-18 11:55 | Worker iter 2 | done in 327s, ctx: 32%, tools: 40 |
| 2026-03-18 11:57 | Review R004 | code Step 1: REVISE |
| 2026-03-18 11:58 | Review R004 | code Step 1: REVISE |
| 2026-03-18 12:01 | Worker iter 2 | done in 174s, ctx: 16%, tools: 29 |
| 2026-03-18 12:01 | Step 1 complete | Refactor Worktree Path Generation |
| 2026-03-18 12:01 | Step 2 started | Update Worktree Listing and Cleanup |
| 2026-03-18 12:03 | Review R005 | plan Step 2: REVISE |

---

## Blockers

*None*

---

## Notes

*Reserved for execution notes*
