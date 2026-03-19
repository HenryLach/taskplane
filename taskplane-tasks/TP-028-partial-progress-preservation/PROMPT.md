# Task: TP-028 — Partial Progress Preservation

**Created:** 2026-03-19
**Size:** M

## Review Level: 2 (Plan and Code)

**Assessment:** Modifies cleanup and task outcome paths. Must preserve commits that would otherwise become unreachable. Workspace-aware branch operations.
**Score:** 4/8 — Blast radius: 1, Pattern novelty: 1, Security: 0, Reversibility: 2

## Canonical Task Folder

```
taskplane-tasks/TP-028-partial-progress-preservation/
├── PROMPT.md   ← This file
├── STATUS.md   ← Execution state
├── .reviews/   ← Reviewer output
└── .DONE       ← Created when complete
```

## Mission

When a task fails without creating `.DONE` but has commits on its lane branch,
preserve those commits as a recoverable saved branch instead of letting them
become unreachable during worktree cleanup. Record the partial progress (commit
count, branch name) in the task outcome for operator visibility. This must work
in both repo mode and workspace mode.

## Dependencies

- **None**

## Context to Read First

**Tier 2 (area context):**
- `taskplane-tasks/CONTEXT.md`

**Tier 3 (load only if needed):**
- `docs/specifications/taskplane/resilience-and-diagnostics-roadmap.md` — Phase 2 section 2a
- `extensions/taskplane/worktree.ts` — Current worktree cleanup logic (`removeAllWorktrees`, `forceCleanupWorktree`)
- `extensions/taskplane/execution.ts` — Task outcome recording
- `extensions/taskplane/naming.ts` — Naming contract

## Environment

- **Workspace:** `extensions/taskplane/`
- **Services required:** None

## File Scope

- `extensions/taskplane/worktree.ts`
- `extensions/taskplane/execution.ts`
- `extensions/taskplane/types.ts`
- `extensions/tests/partial-progress.test.ts` (new)

## Steps

### Step 0: Preflight

- [ ] Read `removeAllWorktrees()` and `forceCleanupWorktree()` in worktree.ts
- [ ] Read task outcome recording in execution.ts
- [ ] Read roadmap Phase 2 section 2a
- [ ] Understand current saved-branch logic for merge failures

### Step 1: Detect and Save Partial Progress

- [ ] Before worktree removal for a failed task, check if lane branch has commits ahead of base: `git rev-list --count {base}..{lane}`
- [ ] If commits > 0, create a saved branch: `saved/{opId}-{taskId}-{batchId}` (repo mode) or `saved/{opId}-{repoId}-{taskId}-{batchId}` (workspace mode)
- [ ] Skip lane branch deletion when saved branch is created
- [ ] Log: "Task {id} failed but has {N} commits of partial progress on branch saved/{...}"
- [ ] Use correct repo root for branch operations (resolvedRepoId in workspace mode)

**Artifacts:**
- `extensions/taskplane/worktree.ts` (modified)

### Step 2: Record Partial Progress in Task Outcome

- [ ] Add `partialProgressCommits` (number) and `partialProgressBranch` (string|null) fields to task outcome type
- [ ] Populate these fields when saving partial progress
- [ ] Include in batch state task record for dashboard/diagnostic visibility
- [ ] Persist to batch-state.json alongside existing task fields

**Artifacts:**
- `extensions/taskplane/types.ts` (modified)
- `extensions/taskplane/execution.ts` (modified)

### Step 3: Testing & Verification

> ZERO test failures allowed.

- [ ] Test: failed task with lane commits → saved branch created with correct name
- [ ] Test: failed task with no lane commits → no saved branch, normal cleanup
- [ ] Test: workspace mode uses repoId in saved branch name
- [ ] Test: repo mode omits repoId in saved branch name
- [ ] Test: task outcome includes partialProgressCommits and branch name
- [ ] Run full test suite: `cd extensions && npx vitest run`
- [ ] Fix all failures

### Step 4: Documentation & Delivery

- [ ] Update inline comments explaining partial progress preservation
- [ ] `.DONE` created in this folder

## Documentation Requirements

**Must Update:**
- None (docs deferred to Phase 3 diagnostic reports)

**Check If Affected:**
- `docs/reference/commands.md` — if saved branches appear in `/orch-status`

## Completion Criteria

- [ ] All steps complete
- [ ] All tests passing
- [ ] Failed tasks with commits produce saved branches
- [ ] Works in repo mode and workspace mode
- [ ] `.DONE` created

## Git Commit Convention

- **Step completion:** `feat(TP-028): complete Step N — description`
- **Bug fixes:** `fix(TP-028): description`
- **Tests:** `test(TP-028): description`
- **Hydration:** `hydrate: TP-028 expand Step N checkboxes`

## Do NOT

- Modify cleanup for successful tasks (only failed tasks get saved branches)
- Change the merge flow (that's TP-033)
- Break existing worktree cleanup for success paths

---

## Amendments (Added During Execution)
