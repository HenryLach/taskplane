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
**Status:** 🟨 In Progress

- [ ] Read `worktree.ts` — understand all worktree functions and their signatures
- [ ] Read `waves.ts` — understand `allocateLanes()` worktree creation
- [ ] Read `engine.ts` — understand worktree reset and cleanup flows
- [ ] Read `merge.ts` — understand merge worktree creation
- [ ] Read `resume.ts` — understand worktree listing/cleanup in resume flows (R001)
- [ ] Read relevant test files — `worktree-lifecycle.test.ts`, `naming-collision.test.ts` for old naming patterns (R001)
- [ ] Grep-based caller inventory: log all callers of `generateWorktreePath`, `listWorktrees`, `removeAllWorktrees` in STATUS.md Discoveries (R001)
- [ ] Note transition behavior needs for `listWorktrees()` old+new naming support (R001)

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
