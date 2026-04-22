# Task: TP-022 - Orch Branch Lifecycle & Merge Redirect

**Created:** 2026-03-18
**Size:** L

## Review Level: 2 (Plan and Code)

**Assessment:** Core behavioral change — modifies the batch execution loop and merge flow. High blast radius across engine and merge modules.
**Score:** 5/8 — Blast radius: 2, Pattern novelty: 1, Security: 0, Reversibility: 2

## Canonical Task Folder

```
taskplane-tasks/TP-022-orch-branch-lifecycle-merge-redirect/
├── PROMPT.md   ← This file (immutable above --- divider)
├── STATUS.md   ← Execution state (worker updates this)
├── .reviews/   ← Reviewer output (task-runner creates this)
└── .DONE       ← Created when complete
```

## Mission

Implement the orchestrator-managed branch lifecycle: the orchestrator creates `orch/{opId}-{batchId}` at batch start, uses it as the base for all worktrees and merge target, and never touches the user's current branch. This is the central behavioral change of issue #24.

After this task, the merge step no longer fast-forwards the user's branch. Instead, it updates the orch branch via `git update-ref`, keeping the user's checkout completely isolated. The batch completion message tells the user how to integrate.

## Dependencies

- **Task:** TP-020 (schema must have `orchBranch` and `integration` fields)
- **Task:** TP-021 (worktree paths must be batch-scoped)

## Context to Read First

**Tier 2 (area context):**
- `taskplane-tasks/CONTEXT.md`

**Tier 3 (load only if needed):**
- `.pi/local/docs/orch-managed-branch-spec.md` — full spec (sections 2, 6.3, 6.4, 6.5)
- `extensions/taskplane/engine.ts` — batch execution loop (Phase 1 planning, Phase 2 wave loop, Phase 3 cleanup)
- `extensions/taskplane/merge.ts` — `mergeWave()` and `mergeWaveByRepo()`, fast-forward logic, stash/pop
- `extensions/taskplane/waves.ts` — `resolveBaseBranch()`, `allocateLanes()`
- `extensions/taskplane/persistence.ts` — state serialization

## Environment

- **Workspace:** `extensions/taskplane/`
- **Services required:** None


## Execution Target

- **Repo:** taskplane
- **Submodule path:** `.pi/git/github.com/loopyd/taskplane`
- **Upstream URL:** `https://github.com/loopyd/taskplane.git`

> This task operates within the `taskplane` submodule. All file paths, git operations, and worktrees are scoped to this submodule's repository root.

## File Scope

- `extensions/taskplane/engine.ts`
- `extensions/taskplane/merge.ts`
- `extensions/taskplane/waves.ts`
- `extensions/taskplane/persistence.ts`
- `extensions/taskplane/messages.ts`
- `extensions/tests/*`

## Steps

### Step 0: Preflight

- [ ] Read `engine.ts` — understand Phase 1 (planning, baseBranch capture), Phase 2 (wave loop, executeWave/mergeWaveByRepo calls, worktree reset), Phase 3 (cleanup, branch deletion)
- [ ] Read `merge.ts` — understand `mergeWave()`: temp branch creation, merge worktree, sequential merge loop, fast-forward step (`git merge --ff-only`), stash/pop logic, cleanup
- [ ] Read `waves.ts` — understand `resolveBaseBranch()` and how `allocateLanes()` passes baseBranch to `createWorktree()`
- [ ] Read `persistence.ts` — understand `orchBranch` serialization (added by TP-020)
- [ ] Verify TP-020 and TP-021 changes are present (orchBranch field, batch-scoped worktree paths)

### Step 1: Create Orch Branch at Batch Start

In `engine.ts`, after capturing `baseBranch` and generating `batchId`:

- [ ] Generate orch branch name: `orch/{opId}-{batchId}`
- [ ] Create the branch: `git branch {orchBranch} {baseBranch}` using `runGit()`
- [ ] Store in `batchState.orchBranch`
- [ ] Handle failure: if branch creation fails (e.g., branch already exists), fail the batch with clear error
- [ ] Log: `execLog("batch", batchId, "created orch branch", { orchBranch, baseBranch })`

**Artifacts:**
- `extensions/taskplane/engine.ts` (modified)

### Step 2: Route Worktrees and Merge to Orch Branch

- [ ] In `engine.ts`: pass `batchState.orchBranch` (not `baseBranch`) to `executeWave()` as the base for worktrees
- [ ] In `engine.ts`: pass `batchState.orchBranch` (not `baseBranch`) to `mergeWaveByRepo()` as the merge target
- [ ] In `engine.ts`: post-merge worktree reset uses `batchState.orchBranch` as target branch (not `baseBranch`)
- [ ] In `waves.ts`: in repo mode, `resolveBaseBranch()` should use the passed-in base branch directly (which is now orchBranch). In workspace mode, the per-repo detection logic may still apply — but verify the orch branch exists in the correct repo.

**Artifacts:**
- `extensions/taskplane/engine.ts` (modified)
- `extensions/taskplane/waves.ts` (modified, if needed)

### Step 3: Replace Fast-Forward with update-ref in Merge

In `merge.ts`, the current fast-forward logic does:
```javascript
git merge --ff-only tempBranch  // in repoRoot — touches user's checkout
```
With stash/pop fallback for dirty working trees.

Replace with:
- [ ] After successful lane merges, get the temp branch's HEAD: `git rev-parse {tempBranch}`
- [ ] Update the orch branch ref: `git update-ref refs/heads/{orchBranch} {tempBranchHead}`
- [ ] This does NOT touch the working tree — the orch branch is never checked out in the main repo
- [ ] Remove the stash/pop logic entirely (no longer needed)
- [ ] The `targetBranch` variable in `mergeWave()` is now the orch branch (received via the `baseBranch` parameter, which engine.ts now passes as `orchBranch`)
- [ ] The merge worktree still checks out a temp branch based on `targetBranch` (now the orch branch) — this part doesn't change

**Artifacts:**
- `extensions/taskplane/merge.ts` (modified)

### Step 4: Auto-Integration and Cleanup

In `engine.ts` Phase 3 (cleanup):

- [ ] If `config.orchestrator.integration === "auto"`: attempt fast-forward of `baseBranch` to `orchBranch` in the main repo. Log result. If diverged, warn and preserve orch branch.
- [ ] If integration is `"manual"` (default) OR auto-ff failed: preserve the orch branch and show integration instructions
- [ ] Update batch completion notification to include orch branch info:
  - `"ℹ Batch complete. Orch branch {orchBranch} has N merged tasks.\n  Run /orch-integrate to apply, or review:\n  git log {baseBranch}..{orchBranch}"`
- [ ] Branch deletion in cleanup: do NOT delete `orchBranch` (it's preserved for integration). Delete lane branches as before (they're merged into the orch branch).
- [ ] Add completion message to `messages.ts` if using the ORCH_MESSAGES pattern

**Artifacts:**
- `extensions/taskplane/engine.ts` (modified)
- `extensions/taskplane/messages.ts` (modified)

### Step 5: Testing & Verification

> ZERO test failures allowed.

- [ ] Run unit tests: `cd extensions && npx vitest run`
- [ ] Verify orch branch creation logic handles edge cases (detached HEAD, branch already exists)
- [ ] Verify merge no longer touches user's branch (no `git merge --ff-only` in main repo)
- [ ] Verify worktrees are based on orch branch
- [ ] Verify post-merge worktree reset targets orch branch
- [ ] Verify auto-integration logic
- [ ] Verify cleanup preserves orch branch when integration is manual
- [ ] Fix all failures

### Step 6: Documentation & Delivery

- [ ] Discoveries logged in STATUS.md
- [ ] `.DONE` created in this folder

## Documentation Requirements

**Must Update:**
- None (docs task TP-024 handles user-facing docs)

**Check If Affected:**
- `docs/explanation/architecture.md` — merge flow description may be outdated (handled by TP-024)

## Completion Criteria

- [ ] Orch branch created at batch start
- [ ] All worktrees branch from orch branch (not user branch)
- [ ] Merge updates orch branch via update-ref (not ff in main checkout)
- [ ] User's branch/checkout never touched
- [ ] Auto-integration works when configured
- [ ] Orch branch preserved for manual integration by default
- [ ] Completion message shows integration instructions
- [ ] All tests passing

## Git Commit Convention

- **Step completion:** `feat(TP-022): complete Step N — description`
- **Bug fixes:** `fix(TP-022): description`
- **Tests:** `test(TP-022): description`
- **Hydration:** `hydrate: TP-022 expand Step N checkboxes`

## Do NOT

- Add the `/orch-integrate` command — that's TP-023
- Change worktree path generation — that's TP-021 (already done)
- Change schema/types — that's TP-020 (already done)
- Modify the merge agent protocol (the merge request/result JSON format)
- Break the resume flow — persisted state with `orchBranch` must be loadable
- Skip tests

---

## Amendments (Added During Execution)
