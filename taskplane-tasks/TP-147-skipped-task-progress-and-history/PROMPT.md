# Task: TP-147 - Skipped Task Progress Preservation and Batch History Completeness

**Created:** 2026-04-07
**Size:** M

## Review Level: 2 (Plan and Code)

**Assessment:** Two related issues around task lifecycle edge cases. Touches merge path (skipped task branches) and persistence (batch history).
**Score:** 4/8 — Blast radius: 2 (merge, persistence), Pattern novelty: 1, Security: 0, Reversibility: 1

## Canonical Task Folder

```
taskplane-tasks/TP-147-skipped-task-progress-and-history/
├── PROMPT.md
├── STATUS.md
├── .reviews/
└── .DONE
```

## Mission

Fix two related issues discovered during polyrepo testing:

### Issue 1: Skipped tasks lose worker progress (#453)

When a task is skipped (e.g., TP-005 was skipped in an earlier test run), its lane branch is excluded from the wave merge. Any commits the worker made (STATUS.md updates, partial code) are permanently lost when the worktree is cleaned up.

**Fix options:**
- **(A) Merge partial work from skipped tasks:** Include skipped-task lane branches in the merge, but mark them clearly in the merge commit.
- **(B) Save the branch:** Don't delete skipped-task lane branches during cleanup. Preserve them as `saved/{opId}-{taskId}-{batchId}` branches for manual recovery.
- **(C) Auto-commit + stash:** Use the safety-net auto-commit (v0.24.25) for skipped lanes too, then save the branch.

**Recommended: Option B+C** — auto-commit any uncommitted work, save the branch, but don't merge it (partial work could break tests).

### Issue 2: Tasks missing from batch history (#455)

TP-006 was completely absent from `batch-history.json` despite being in the wave plan. The batch had `totalTasks: 8` but only 7 task entries in the history.

**Fix:** Ensure ALL tasks in the wave plan are recorded in batch history, even if they never started execution (status: "pending" or "blocked").

## Dependencies

- None

## Context to Read First

**Tier 2:**
- `taskplane-tasks/CONTEXT.md`

**Tier 3:**
- `extensions/taskplane/engine.ts` — wave cleanup, branch deletion, safety-net auto-commit
- `extensions/taskplane/merge.ts` — lane branch merge selection
- `extensions/taskplane/persistence.ts` — batch history serialization

## File Scope

- `extensions/taskplane/engine.ts`
- `extensions/taskplane/merge.ts`
- `extensions/taskplane/persistence.ts`
- `extensions/tests/orch-state-persistence.test.ts`

## Steps

### Step 0: Preflight
- [ ] Read PROMPT.md and STATUS.md
- [ ] Read engine.ts wave cleanup and branch deletion logic
- [ ] Read merge.ts lane branch selection (how skipped lanes are excluded)
- [ ] Read persistence.ts batch history serialization

### Step 1: Preserve skipped task branches
- [ ] Extend safety-net auto-commit to cover skipped-task lanes (not just succeeded)
- [ ] After auto-commit, save the branch as `saved/{opId}-{taskId}-{batchId}` instead of deleting
- [ ] Log the saved branch name for operator visibility
- [ ] Do NOT merge skipped lanes (partial work may break tests)
- [ ] Run targeted tests

**Artifacts:**
- `extensions/taskplane/engine.ts` (modified)

### Step 2: Fix batch history completeness
- [ ] In batch history serialization, include ALL tasks from the wave plan
- [ ] Tasks that never started: status "pending" or "blocked", no timing data
- [ ] Tasks that were skipped: status "skipped"
- [ ] Verify totalTasks matches task array length
- [ ] Run targeted tests

**Artifacts:**
- `extensions/taskplane/persistence.ts` (modified)

### Step 3: Testing & Verification

> ZERO test failures allowed. Full suite quality gate.

- [ ] Test: skipped task branch saved (not deleted)
- [ ] Test: batch history includes all tasks including never-started ones
- [ ] Test: totalTasks == task array length
- [ ] Run FULL test suite: `cd extensions && node --experimental-strip-types --experimental-test-module-mocks --no-warnings --import ./tests/loader.mjs --test tests/*.test.ts`
- [ ] Fix all failures

### Step 4: Documentation & Delivery
- [ ] Update STATUS.md

## Git Commit Convention

- `feat(TP-147): complete Step N — description`

## Do NOT

- Merge skipped task branches into the orch branch (partial work could break verification)
- Delete the saved branches automatically (operator decides what to do with them)
- Change the batch history schema in a breaking way

---

## Amendments (Added During Execution)

<!-- Workers add amendments here if issues discovered during execution. -->
