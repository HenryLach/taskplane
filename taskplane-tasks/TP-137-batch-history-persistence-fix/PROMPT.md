# Task: TP-137 - Batch History Persistence Fix

**Created:** 2026-04-03
**Size:** S

## Review Level: 1 (Plan Only)

**Assessment:** Fix batch history not being written/preserved for recent batches. Low blast radius, focused on persistence and integration flow.
**Score:** 2/8 — Blast radius: 1, Pattern novelty: 0, Security: 0, Reversibility: 1

## Canonical Task Folder

```
taskplane-tasks/TP-137-batch-history-persistence-fix/
├── PROMPT.md
├── STATUS.md
├── .reviews/
└── .DONE
```

## Mission

Fix the bug where `batch-history.json` is not updated for recently completed batches (#423). The dashboard batch history dropdown shows stale data — users see old batches instead of the most recent completed batch.

### Root Cause Hypothesis

The most likely cause is that `orch_integrate` merges the orch branch into main, and the orch branch has an older copy of `.pi/batch-history.json` (snapshot from when the orch branch was created). The engine-worker writes the updated history to the repo root during batch completion, but then integration overwrites it with the stale orch branch version.

Other possible causes to investigate:
1. `stateRoot` in the engine-worker may resolve differently than expected
2. The batch completion path may not be reached (early exit before `saveBatchHistory`)
3. The write succeeds but targets a different directory (worktree vs repo root)

### What exists

- `persistence.ts`: `saveBatchHistory()` writes to `.pi/batch-history.json` with atomic tmp+rename
- `engine.ts:2952`: Calls `saveBatchHistory(stateRoot, summary)` at batch completion
- `extension.ts`: `orch_integrate` merges orch branch into main (or creates PR)
- Dashboard `server.cjs`: `loadHistory()` reads `.pi/batch-history.json`

## Environment

- **Workspace:** `extensions/taskplane/`, `dashboard/`, `bin/`
- **Services required:** None
- **Submodule workspace:** `.pi/git/github.com/loopyd/taskplane` (absolute: `/mnt/PROJECTS/repos/bof3-decomp/.pi/git/github.com/loopyd/taskplane`)


## Execution Target

- **Repo:** taskplane
- **Submodule path:** `.pi/git/github.com/loopyd/taskplane`
- **Upstream URL:** `https://github.com/loopyd/taskplane.git`

> This task operates within the `taskplane` submodule. All file paths, git operations, and worktrees are scoped to this submodule's repository root.

## Dependencies

- None

## Context to Read First

- `extensions/taskplane/persistence.ts` — `saveBatchHistory()`, `loadBatchHistory()`
- `extensions/taskplane/engine.ts` — batch completion path where history is written
- `extensions/taskplane/extension.ts` — `orch_integrate` merge flow
- `dashboard/server.cjs` — `loadHistory()` for dashboard

## File Scope

- `extensions/taskplane/persistence.ts`
- `extensions/taskplane/engine.ts`
- `extensions/taskplane/extension.ts`
- `extensions/tests/*.test.ts`

## Steps

### Step 0: Preflight
- [ ] Read PROMPT.md and STATUS.md
- [ ] Trace the batch completion path to confirm `saveBatchHistory` is called
- [ ] Trace `orch_integrate` to see how `.pi/` files are handled during merge
- [ ] Check if `.pi/batch-history.json` is in `.gitignore`
- [ ] Determine actual root cause (integration overwrite vs stateRoot mismatch vs other)

### Step 1: Diagnose and fix root cause
- [ ] If integration overwrite: ensure `.pi/batch-history.json` is excluded from orch branch merges, or re-write history after integration
- [ ] If stateRoot mismatch: fix the path resolution in engine-worker context
- [ ] If write not reached: fix the batch completion flow to ensure `saveBatchHistory` runs
- [ ] If `.pi/batch-history.json` tracked by git: add to `.gitignore` (it's runtime state, not source)

### Step 2: Ensure history survives integration
- [ ] After `orch_integrate`, verify `.pi/batch-history.json` contains the latest batch
- [ ] If needed, write a post-integration hook that re-saves the current batch summary
- [ ] Handle edge case: failed batch that was resumed — history should reflect final outcome

### Step 3: Tests
- [ ] Test: batch history is written on batch completion
- [ ] Test: batch history survives orch_integrate
- [ ] Test: dashboard loadHistory returns latest batch
- [ ] Run full suite, fix failures

### Step 4: Documentation & Delivery
- [ ] Update STATUS.md
- [ ] Close #423

## Do NOT

- Change the batch history format (array of summaries, newest first)
- Remove the atomic write pattern (tmp+rename)
- Break the dashboard history API

## Git Commit Convention

- `feat(TP-137): complete Step N — ...`
