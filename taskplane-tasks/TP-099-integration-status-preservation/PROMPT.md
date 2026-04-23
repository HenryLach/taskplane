# Task: TP-099 - Integration STATUS.md Preservation

**Created:** 2026-03-29
**Size:** M

## Review Level: 2 (Plan and Code)

**Assessment:** Fixes STATUS.md execution state being lost during squash merge integration (#356). Every completed task on main shows as "Not Started" despite work being complete. Touches the engine integration and merge flow.
**Score:** 5/8 — Blast radius: 2, Pattern novelty: 1, Security: 0, Reversibility: 2

## Canonical Task Folder

```
taskplane-tasks/TP-099-integration-status-preservation/
├── PROMPT.md   ← This file (immutable above --- divider)
├── STATUS.md   ← Execution state (worker updates this)
├── .reviews/   ← Reviewer output (task-runner creates this)
└── .DONE       ← Created when complete
```

## Mission

Fix the integration flow so STATUS.md execution state (checked items, hydrated checkboxes, reviews, discoveries, execution log) survives through to main (#356).

**Root cause:** During `git rebase main` before PR creation, checkpoint commits that update STATUS.md conflict with main's original version. Git auto-resolves by dropping the STATUS.md changes. The subsequent squash merge has no STATUS.md diff.

**Fix approach:** After the wave merge creates the checkpoint commit on the orch branch, ensure STATUS.md files are explicitly committed. Then during integration (the `orch_integrate` flow or manual PR), verify STATUS.md files match the orch branch's final state. If they don't (rebase dropped them), restore from the orch branch before the squash merge.

## Dependencies

- **None**

## Context to Read First

**Tier 2 (area context):**
- `taskplane-tasks/CONTEXT.md`

**Tier 3 (load only if needed):**
- `extensions/taskplane/engine.ts` — post-wave merge, checkpoint commit logic
- `extensions/taskplane/merge.ts` — how lane merges work, artifact checkpointing
- GitHub issue #356

## Environment

- **Workspace:** `extensions/`
- **Services required:** None


## Execution Target

- **Repo:** taskplane
- **Submodule path:** `.pi/git/github.com/loopyd/taskplane`
- **Upstream URL:** `https://github.com/loopyd/taskplane.git`

> This task operates within the `taskplane` submodule. All file paths, git operations, and worktrees are scoped to this submodule's repository root.

## File Scope

- `extensions/taskplane/engine.ts`
- `extensions/taskplane/merge.ts`
- `extensions/taskplane/extension.ts`
- `extensions/tests/orch-integrate.integration.test.ts`

## Steps

### Step 0: Preflight

- [ ] Read the checkpoint commit logic in engine.ts — how STATUS.md and .DONE files are committed to the orch branch
- [ ] Read the `orch_integrate` flow in extension.ts — how the orch branch is merged to main
- [ ] Trace the rebase path: where does `git rebase main` happen before PR creation?
- [ ] Read GitHub issue #356

### Step 1: Diagnose the exact merge/rebase conflict

- [ ] Create a test scenario: main has original STATUS.md, orch branch has updated STATUS.md
- [ ] Run `git rebase main` on the orch branch and observe if STATUS.md changes survive
- [ ] Identify if the issue is in rebase, squash merge, or both
- [ ] Document the exact git operation that drops the changes

### Step 2: Implement STATUS.md preservation

Based on diagnosis, implement one of:

**Option A (post-rebase verification):** After `git rebase main`, compare STATUS.md files between the rebased branch and the pre-rebase commit. If any STATUS.md was silently reverted, cherry-pick or re-apply the STATUS.md changes.

**Option B (avoid rebase for task artifacts):** Use `--strategy-option theirs` for STATUS.md files during rebase, or use merge commits instead of rebase for the integration step.

**Option C (post-integration recovery):** After integration to main, copy STATUS.md files from the orch branch's final checkpoint commit. This is the simplest and most reliable.

- [ ] Implement the chosen approach
- [ ] Ensure .DONE files and .reviews/ directories also survive (same mechanism)

**Artifacts:**
- `extensions/taskplane/extension.ts` (modified — orch_integrate flow)

### Step 3: Testing & Verification

> ZERO test failures allowed.

- [ ] Test: STATUS.md with checked items survives integration
- [ ] Test: .DONE file survives integration
- [ ] Test: .reviews/ directory survives integration
- [ ] Run full suite: `cd extensions && node --experimental-strip-types --experimental-test-module-mocks --no-warnings --import ./tests/loader.mjs --test tests/*.test.ts`
- [ ] Fix all failures

### Step 4: Documentation & Delivery

- [ ] Log discoveries in STATUS.md

## Completion Criteria

- [ ] STATUS.md execution state (checkmarks, reviews, discoveries) present on main after integration
- [ ] .DONE files present on main after integration
- [ ] All tests pass

## Git Commit Convention

- **Step completion:** `feat(TP-099): complete Step N — description`
- **Bug fixes:** `fix(TP-099): description`

## Do NOT

- Modify telemetry pipeline (TP-097)
- Modify dashboard rendering (TP-098)
- Change the squash merge requirement on main
- Skip full-suite tests

---

## Amendments (Added During Execution)

<!-- Workers add amendments here if issues discovered during execution. -->
