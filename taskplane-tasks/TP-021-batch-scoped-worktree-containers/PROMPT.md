# Task: TP-021 - Batch-Scoped Worktree Containers

**Created:** 2026-03-18
**Size:** M

## Review Level: 2 (Plan and Code)

**Assessment:** Refactors worktree path generation across multiple call sites. Medium blast radius, needs careful testing.
**Score:** 4/8 — Blast radius: 2, Pattern novelty: 1, Security: 0, Reversibility: 1

## Canonical Task Folder

```
taskplane-tasks/TP-021-batch-scoped-worktree-containers/
├── PROMPT.md   ← This file (immutable above --- divider)
├── STATUS.md   ← Execution state (worker updates this)
├── .reviews/   ← Reviewer output (task-runner creates this)
└── .DONE       ← Created when complete
```

## Mission

Refactor worktree directory naming to be batch-scoped, preventing collisions between concurrent batches by the same operator. Currently worktree paths are `{basePath}/{prefix}-{opId}-{N}` — two batches with the same operator collide on the same directories.

New scheme: `{basePath}/{opId}-{batchId}/lane-{N}` with a merge worktree at `{basePath}/{opId}-{batchId}/merge`. The entire batch gets a container directory that's trivially cleaned up.

## Dependencies

- **Task:** TP-020 (schema must have `orchBranch` and `integration` fields — needed for batchId threading)

## Context to Read First

**Tier 2 (area context):**
- `taskplane-tasks/CONTEXT.md`

**Tier 3 (load only if needed):**
- `.pi/local/docs/orch-managed-branch-spec.md` — full spec (sections 3, 6.2)
- `extensions/taskplane/worktree.ts` — current worktree functions
- `extensions/taskplane/waves.ts` — `allocateLanes()` calls `createWorktree()`
- `extensions/taskplane/engine.ts` — calls `listWorktrees()`, `removeAllWorktrees()`, worktree reset
- `extensions/taskplane/merge.ts` — creates merge worktree

## Environment

- **Workspace:** `extensions/taskplane/`
- **Services required:** None


## Execution Target

- **Repo:** taskplane
- **Submodule path:** `.pi/git/github.com/loopyd/taskplane`
- **Upstream URL:** `https://github.com/loopyd/taskplane.git`

> This task operates within the `taskplane` submodule. All file paths, git operations, and worktrees are scoped to this submodule's repository root.

## File Scope

- `extensions/taskplane/worktree.ts`
- `extensions/taskplane/waves.ts`
- `extensions/taskplane/engine.ts`
- `extensions/taskplane/merge.ts`
- `extensions/taskplane/execution.ts`
- `extensions/tests/worktree*.test.ts`
- `extensions/tests/waves*.test.ts`

## Steps

### Step 0: Preflight

- [ ] Read `worktree.ts` — understand `generateWorktreePath()`, `generateBranchName()`, `resolveWorktreeBasePath()`, `listWorktrees()`, `removeWorktree()`, `removeAllWorktrees()`, `createWorktree()`, `CreateWorktreeOptions`
- [ ] Read `waves.ts` — understand `allocateLanes()` and how it calls `createWorktree()`
- [ ] Read `engine.ts` — understand worktree reset loop and cleanup in Phase 3
- [ ] Read `merge.ts` — understand merge worktree creation (the `mergeWorkDir` / `tempBranch` pattern)
- [ ] Identify all callers of `generateWorktreePath()` and `listWorktrees()`

### Step 1: Refactor Worktree Path Generation

Refactor path generation to use batch-scoped containers:

- [ ] Update `generateWorktreePath()` — new signature includes `batchId`. Output: `{basePath}/{opId}-{batchId}/lane-{N}`. The function should still use `resolveWorktreeBasePath()` for the base path.
- [ ] Add `generateMergeWorktreePath()` — new function. Output: `{basePath}/{opId}-{batchId}/merge`. Used by merge.ts instead of ad-hoc merge worktree path.
- [ ] Update `CreateWorktreeOptions` to include `batchId` if not already present (check — it may already have it for branch naming)
- [ ] Update `createWorktree()` to use the new path generation
- [ ] Ensure container directory (`{basePath}/{opId}-{batchId}/`) is created automatically (mkdir -p equivalent)

**Artifacts:**
- `extensions/taskplane/worktree.ts` (modified)

### Step 2: Update Worktree Listing and Cleanup

- [ ] Update `listWorktrees()` — must find worktrees inside batch containers. The function currently scans for `{prefix}-{opId}-{N}` pattern. Needs to scan `{opId}-{batchId}/lane-{N}` or accept the container path directly.
- [ ] Update `removeAllWorktrees()` — after removing individual worktrees, remove the batch container directory if empty
- [ ] Update `removeWorktree()` if needed for new path structure
- [ ] Update `forceCleanupWorktree()` if needed

**Artifacts:**
- `extensions/taskplane/worktree.ts` (modified)

### Step 3: Update All Callers

- [ ] Update `allocateLanes()` in `waves.ts` — pass `batchId` to worktree creation
- [ ] Update `engine.ts` Phase 2 — worktree reset loop uses new listing
- [ ] Update `engine.ts` Phase 3 — cleanup uses new removal, removes batch container
- [ ] Update `merge.ts` — use `generateMergeWorktreePath()` instead of ad-hoc `join(repoRoot, ".worktrees", "merge-workspace-{opId}")`. Pass `batchId` to the function.
- [ ] Update `execution.ts` if it directly references worktree paths

**Artifacts:**
- `extensions/taskplane/waves.ts` (modified)
- `extensions/taskplane/engine.ts` (modified)
- `extensions/taskplane/merge.ts` (modified)
- `extensions/taskplane/execution.ts` (modified, if needed)

### Step 4: Testing & Verification

> ZERO test failures allowed.

- [ ] Run unit tests: `cd extensions && npx vitest run`
- [ ] Verify `generateWorktreePath()` produces `{basePath}/{opId}-{batchId}/lane-{N}`
- [ ] Verify `generateMergeWorktreePath()` produces `{basePath}/{opId}-{batchId}/merge`
- [ ] Verify subdirectory vs sibling mode still works with new naming
- [ ] Verify listing finds worktrees in new container structure
- [ ] Verify cleanup removes container directory
- [ ] Fix all failures

### Step 5: Documentation & Delivery

- [ ] Discoveries logged in STATUS.md
- [ ] `.DONE` created in this folder

## Documentation Requirements

**Must Update:**
- None (docs task TP-024 handles user-facing docs)

**Check If Affected:**
- `docs/reference/configuration/taskplane-settings.md` — Worktree Prefix description may need minor update

## Completion Criteria

- [ ] Worktree paths use batch-scoped containers
- [ ] Merge worktree is inside the batch container
- [ ] No collisions between concurrent batches
- [ ] All callers updated
- [ ] All tests passing

## Git Commit Convention

- **Step completion:** `feat(TP-021): complete Step N — description`
- **Bug fixes:** `fix(TP-021): description`
- **Tests:** `test(TP-021): description`
- **Hydration:** `hydrate: TP-021 expand Step N checkboxes`

## Do NOT

- Change branch naming (`generateBranchName()`) — those already include batchId
- Implement orch branch creation or merge redirect — that's TP-022
- Modify the merge agent protocol — that's TP-022
- Change config schema — that's TP-020
- Skip tests
- Break backward compatibility for `listWorktrees()` — ensure it can find both old and new style paths during the transition

---

## Amendments (Added During Execution)
