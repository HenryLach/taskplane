# R005 — Plan Review (Step 2: Update execution contracts)

## Verdict
**Changes requested**

## What I reviewed
- `taskplane-tasks/TP-004-repo-scoped-lane-allocation-and-worktrees/PROMPT.md`
- `taskplane-tasks/TP-004-repo-scoped-lane-allocation-and-worktrees/STATUS.md`
- `extensions/taskplane/execution.ts`
- `extensions/taskplane/engine.ts`
- `extensions/taskplane/resume.ts`
- `extensions/taskplane/abort.ts`
- `extensions/taskplane/worktree.ts`

## Findings

### 1) **Blocking**: Step 2.2c assumes cross-repo cleanup is already handled, but current cleanup APIs are repo-scoped
`STATUS.md` currently marks Step 2.2c as done with the claim that cleanup is “repo-agnostic” by prefix. That assumption is incorrect in the current code path:

- `listWorktrees(prefix, repoRoot)` is repo-root scoped (`extensions/taskplane/worktree.ts:1050`), and internally calls `parseWorktreeList(repoRoot)` (`worktree.ts:1051`).
- `parseWorktreeList(cwd)` runs `git worktree list --porcelain` in that one repo (`worktree.ts:96`), so it cannot see worktrees belonging to other repos.
- Engine terminal cleanup calls `removeAllWorktrees(prefix, repoRoot, ...)` once for the main repo only (`extensions/taskplane/engine.ts:683`).
- Resume terminal cleanup does the same (`extensions/taskplane/resume.ts:1064`), and resume between-wave reset also lists worktrees only from main repo (`resume.ts:1043`).

So in workspace mode, worktrees in non-default repos can be left behind/reset-skipped. That conflicts with TP-004’s worktree lifecycle goal and with Step 1’s deferred remove-path ownership.

## Required updates before approval
1. **Replace Step 2.2c with an explicit multi-repo cleanup contract** (not “no changes needed”):
   - Define how cleanup repo roots are collected deterministically in workspace mode.
   - Update engine and resume cleanup paths to iterate those repo roots.
   - Include resume between-wave reset behavior in this contract (currently single-repo).

2. **Add targeted tests for cleanup lifecycle in workspace mode**:
   - Workspace-mode case with 2 repos verifies cleanup/reset touches both repo roots.
   - Repo-mode regression verifies single-repo behavior is unchanged.

3. **Metadata hygiene**: top-of-file status currently says `Step 2 / In Progress` while Step 2 section is marked complete; align these for clean handoff.

## Note
Step 2.2a and 2.2b planning/execution direction looks good and is concrete. The blocking issue is specifically the incorrect cleanup assumption in 2.2c.
