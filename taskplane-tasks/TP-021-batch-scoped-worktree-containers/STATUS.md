# TP-021: Batch-Scoped Worktree Containers — Status

**Current Step:** Not Started
**Status:** 🔵 Ready for Execution
**Last Updated:** 2026-03-18
**Review Level:** 2
**Review Counter:** 0
**Iteration:** 0
**Size:** M

---

### Step 0: Preflight
**Status:** ⬜ Not Started

- [ ] Read `worktree.ts` — understand all worktree functions and their signatures
- [ ] Read `waves.ts` — understand `allocateLanes()` worktree creation
- [ ] Read `engine.ts` — understand worktree reset and cleanup flows
- [ ] Read `merge.ts` — understand merge worktree creation
- [ ] Identify all callers of path/listing functions

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

---

## Blockers

*None*

---

## Notes

*Reserved for execution notes*
