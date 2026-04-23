# Task: TP-029 — Cleanup Resilience & Post-Merge Gate

**Created:** 2026-03-19
**Size:** M

## Review Level: 2 (Plan and Code)

**Assessment:** Modifies merge and cleanup flow across polyrepo boundary. Addresses issue #93 (stale worktrees). Must not break merge path.
**Score:** 5/8 — Blast radius: 2, Pattern novelty: 1, Security: 0, Reversibility: 2

## Canonical Task Folder

```
taskplane-tasks/TP-029-cleanup-resilience-and-gate/
├── PROMPT.md   ← This file
├── STATUS.md   ← Execution state
├── .reviews/   ← Reviewer output
└── .DONE       ← Created when complete
```

## Mission

Fix issue #93: stale lane worktrees and branches not cleaned up in non-final-wave
repos. Extend `forceCleanupWorktree()` fallback to merge worktrees. Add a
post-merge cleanup gate that blocks next-wave execution if cleanup fails. Implement
polyrepo cleanup acceptance criteria so that after `/orch-integrate`, no registered
worktrees, lane branches, or stale autostashes remain in any workspace repo.

## Dependencies

- **None**

## Context to Read First

**Tier 2 (area context):**
- `taskplane-tasks/CONTEXT.md`

**Tier 3 (load only if needed):**
- `docs/specifications/taskplane/resilience-and-diagnostics-roadmap.md` — Phase 2 sections 2b, 2c, 2d
- `extensions/taskplane/worktree.ts` — Current cleanup logic
- `extensions/taskplane/merge.ts` — Merge worktree lifecycle
- `extensions/taskplane/engine.ts` — Wave finalization flow
- `extensions/taskplane/extension.ts` — `/orch-integrate` implementation

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
- `extensions/taskplane/merge.ts`
- `extensions/taskplane/engine.ts`
- `extensions/taskplane/extension.ts`
- `extensions/tests/cleanup-resilience.test.ts` (new)

## Steps

### Step 0: Preflight

- [ ] Read worktree cleanup flow end-to-end (engine → worktree.ts)
- [ ] Read merge worktree lifecycle in merge.ts
- [ ] Understand issue #93: WHY only last-wave repos get cleanup
- [ ] Read roadmap Phase 2 sections 2b, 2c, 2d

### Step 1: Fix Per-Wave Cleanup Across All Repos

- [ ] After wave merge completes, iterate over ALL workspace repos that had lanes in that wave (not just last repo processed)
- [ ] For each repo: remove lane worktrees, delete lane branches, remove empty `.worktrees/` containers
- [ ] Apply `forceCleanupWorktree()` pattern: try `git worktree remove --force`, fall back to `rm -rf` + `git worktree prune`
- [ ] Extend merge worktree cleanup with same fallback pattern (currently only lane worktrees have fallback)
- [ ] Remove empty `.worktrees/` parent directories after all lane worktrees cleaned

**Artifacts:**
- `extensions/taskplane/worktree.ts` (modified)
- `extensions/taskplane/engine.ts` (modified)

### Step 2: Post-Merge Cleanup Gate

- [ ] After merge + cleanup, verify cleanup succeeded in all repos before marking wave complete
- [ ] If cleanup fails: keep merged commits, force batch phase to `paused`, block next wave
- [ ] Emit diagnostic with repo-specific failure details and manual recovery commands
- [ ] Add `cleanup_post_merge_failed` failure classification

**Artifacts:**
- `extensions/taskplane/engine.ts` (modified)
- `extensions/taskplane/types.ts` (modified if adding classification)

### Step 3: Integrate Cleanup into /orch-integrate

- [ ] After `/orch-integrate` ff merge, clean up any remaining autostash entries created by the current batch
- [ ] Verify polyrepo cleanup acceptance criteria: no registered worktrees, no lane branches, no orch branches, no stale autostash, no non-empty `.worktrees/` containers
- [ ] Report cleanup status in integrate result message

**Artifacts:**
- `extensions/taskplane/extension.ts` (modified)

### Step 4: Testing & Verification

> ZERO test failures allowed.

- [ ] Test: multi-repo wave cleanup cleans ALL repos, not just last
- [ ] Test: force cleanup fallback handles orphaned worktrees
- [ ] Test: cleanup gate blocks next wave on cleanup failure
- [ ] Test: `/orch-integrate` cleans autostash entries
- [ ] Test: polyrepo acceptance criteria validated after integrate
- [ ] Run full test suite: `cd extensions && npx vitest run`
- [ ] Fix all failures

### Step 5: Documentation & Delivery

- [ ] Close issue #93 with commit reference
- [ ] `.DONE` created in this folder

## Documentation Requirements

**Must Update:**
- None (cleanup is internal behavior)

**Check If Affected:**
- `docs/reference/commands.md` — if `/orch-integrate` message changes

## Completion Criteria

- [ ] All steps complete
- [ ] All tests passing
- [ ] Issue #93 resolved
- [ ] Cleanup works across all workspace repos in every wave
- [ ] Cleanup gate blocks next wave on failure
- [ ] `.DONE` created

## Git Commit Convention

- **Step completion:** `feat(TP-029): complete Step N — description`
- **Bug fixes:** `fix(TP-029): description`
- **Tests:** `test(TP-029): description`
- **Hydration:** `hydrate: TP-029 expand Step N checkboxes`

## Do NOT

- Break the merge flow (cleanup is post-merge, not part of merge)
- Delete merged commits during cleanup failure recovery
- Change `/orch` spawn or wave planning logic

---

## Amendments (Added During Execution)
