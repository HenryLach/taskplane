# Task: TP-051 - Fix Stale Branches After Integrate and Task Timing

**Created:** 2026-03-24
**Size:** M

## Review Level: 2 (Plan and Code)

**Assessment:** Two bug fixes touching integrate cleanup and task timing. Moderate blast radius — integrate cleanup affects every batch, timing affects dashboard history. Existing patterns with some git plumbing novelty.
**Score:** 4/8 — Blast radius: 2, Pattern novelty: 1, Security: 0, Reversibility: 1

## Canonical Task Folder

```
taskplane-tasks/TP-051-bug-stale-branches-and-timestamps/
├── PROMPT.md   ← This file (immutable above --- divider)
├── STATUS.md   ← Execution state (worker updates this)
├── .reviews/   ← Reviewer output (task-runner creates this)
└── .DONE       ← Created when complete
```

## Mission

Fix two bugs that degrade the operator experience after every batch:

1. **Issue #142 — stale branches after integrate:** `/orch-integrate` cleans up
   worktree directories but leaves behind `task/*` and `saved/*` git branches
   from the integrated batch (and sometimes from previous batches). These
   accumulate over time, cluttering `git branch` output.

2. **Issue #19 — task startedAt uses STATUS.md mtime:** The dashboard and batch
   history show task start times derived from STATUS.md file modification time
   instead of the actual execution start timestamp. This produces incorrect
   timing when STATUS.md was edited before execution (e.g., during task staging).

## Dependencies

- **None**

## Context to Read First

**Tier 2 (area context):**
- `taskplane-tasks/CONTEXT.md`

**Tier 3 (load only if needed):**
- `extensions/taskplane/extension.ts` — `/orch-integrate` command handler. Look for where cleanup runs after integration and where branch deletion could be added.
- `extensions/taskplane/worktree.ts` — `collectRepoCleanupFindings()` detects stale branches but may not delete them. Also check worktree removal functions.
- `extensions/taskplane/engine.ts` — `executeOrchBatch()` where task timing is recorded. Look for `startedAt` fields on task records.
- `extensions/taskplane/execution.ts` — lane execution and monitoring where task start timestamps originate.
- `extensions/taskplane/persistence.ts` — batch history writing, task outcome recording.

## Environment

- **Workspace:** `extensions/`
- **Services required:** None

## File Scope

- `extensions/taskplane/extension.ts` (integrate cleanup)
- `extensions/taskplane/worktree.ts` (branch cleanup logic)
- `extensions/taskplane/execution.ts` (task timing)
- `extensions/taskplane/engine.ts` (task timing)
- `extensions/taskplane/persistence.ts` (history timing)
- `extensions/tests/*` (new or modified tests)

## Steps

### Step 0: Preflight

- [ ] Read `/orch-integrate` handler in `extension.ts` to understand current cleanup flow
- [ ] Read `collectRepoCleanupFindings()` in `worktree.ts` to see how stale branches are detected
- [ ] Read task start timing in `execution.ts` and `engine.ts` to find where `startedAt` is set
- [ ] Identify the branch naming patterns: `task/{opId}-lane-{N}-{batchId}` and `saved/task/{opId}-lane-{N}-{batchId}`

### Step 1: Delete stale task/saved branches after integrate

After `/orch-integrate` completes successfully:
1. Identify all `task/*` and `saved/*` branches that belong to the integrated batch
   (match by batchId from batch state)
2. Delete them via `git branch -D`
3. Best-effort: also scan for orphaned `task/*` and `saved/*` branches from previous
   batches that were never cleaned, and delete those too
4. Log what was deleted for operator visibility

The `orch/` branch handling depends on mode:
- Direct merge (`/orch-integrate`): delete orch branch after merge
- PR mode (`/orch-integrate --pr`): preserve orch branch (PR needs it)

**Artifacts:**
- `extensions/taskplane/extension.ts` or `extensions/taskplane/worktree.ts` (modified)

### Step 2: Fix task startedAt to use actual execution start

Find where task `startedAt` is set and ensure it uses the actual timestamp when
the lane begins executing the task (not STATUS.md mtime). The fix should affect:
- Lane monitoring state (what the dashboard shows in real-time)
- Batch history entries (what appears in post-batch summaries)

Look for patterns like `statSync(statusPath).mtimeMs` or similar mtime-based
timing and replace with `Date.now()` captured at execution start.

**Artifacts:**
- `extensions/taskplane/execution.ts` and/or `extensions/taskplane/engine.ts` (modified)

### Step 3: Testing & Verification

> ZERO test failures allowed.

- [ ] Run tests: `cd extensions && npx vitest run`
- [ ] Add tests for: branch cleanup deletes task/* and saved/* branches
- [ ] Add tests for: branch cleanup preserves orch/* branch in PR mode
- [ ] Add tests for: task startedAt is a timestamp, not file mtime

### Step 4: Documentation & Delivery

- [ ] Discoveries logged in STATUS.md
- [ ] `.DONE` created in this folder

## Documentation Requirements

**Must Update:** None

**Check If Affected:**
- `docs/how-to/troubleshoot-common-issues.md` — if it mentions stale branches

## Completion Criteria

- [ ] `task/*` and `saved/*` branches deleted after `/orch-integrate`
- [ ] Orphaned branches from previous batches also cleaned
- [ ] Task startedAt uses actual execution timestamp
- [ ] All tests passing
- [ ] `.DONE` created

## Git Commit Convention

- **Step completion:** `feat(TP-051): complete Step N — description`
- **Bug fixes:** `fix(TP-051): description`
- **Tests:** `test(TP-051): description`

## Do NOT

- Delete the orch/* branch in PR mode (PR needs it)
- Change batch-state.json schema
- Modify the worktree creation/removal logic (only add branch cleanup)

---

## Amendments (Added During Execution)
