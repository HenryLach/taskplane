---
name: batch-reset
version: 1.0.0
description: Fully resets a Taskplane workspace for a fresh batch run. Backs up existing tasks, creates a clean .pi/tasks/ with only specified tasks, and clears residual state including batch-state.json, runtime/, supervisor/, diagnostics/, mailbox/, telemetry/, and verification/. Use when restarting from a clean slate after failed batches, re-running a selected subset of tasks, or testing a new task configuration from scratch.
---

# Batch Reset Skill

Fully resets the Taskplane workspace for fresh batch execution. This handles:
1. Backing up existing tasks to `.pi/tasks.bak`
2. Creating a fresh `.pi/tasks/` with only selected tasks
3. Cleaning residual orchestration state

## Prerequisites

- Project must have `.pi/taskplane-config.json` configured
- Existing batch must be stopped or paused, not actively running
- Git working tree should be clean aside from expected `.pi/` task state
- If batch is in "executing" phase with running tasks, wait for completion before resuming

## Usage

When the operator says "reset for fresh batch" or wants to run a specific set of tasks from scratch:

1. **Backup current tasks**: Move `.pi/tasks/` to `.pi/tasks.bak/`
2. **Select target tasks**: Identify which task folders to include in the clean slate
3. **Copy selected tasks**: Replicate only those into fresh `.pi/tasks/`
4. **Clean residual state**: Remove `batch-state.json`, clear `runtime/`, `supervisor/`, `diagnostics/`, `mailbox/`, `telemetry/`, `verification/`
5. **Verify**: Ensure there are no stale `.DONE` markers, worktrees, or residual orchestration branches

## Steps

### Step 1: Check current batch state

Before resetting, check if the batch is in a valid state:

```bash
cat .pi/batch-state.json | python3 -c "import json,sys; d=json.load(sys.stdin); print(f'Phase: {d[\"phase\"]}, Wave: {d[\"currentWaveIndex\"]+1}/{d[\"totalWaves\"]}, Tasks: {d[\"succeededTasks\"]}s/{d[\"failedTasks\"]}f/{d[\"skippedTasks\"]}k/{d[\"totalTasks\"]}')"
```

If phase is "executing" and tasks are running, wait for completion before proceeding.

### Step 2: Backup existing tasks

```bash
mv .pi/tasks .pi/tasks.bak
```

### Step 3: Create fresh task directory structure

Identify the target areas and copy only those task folders:

```bash
mkdir -p .pi/tasks/{area1,area2,...}
cp -r .pi/tasks.bak/area1/TASK-XXX-task-name .pi/tasks/area1/
# Repeat for each selected task folder
```

### Step 4: Clean residual orchestration state

```bash
rm -rf .pi/runtime/* .pi/supervisor/* .pi/diagnostics/* .pi/mailbox/* .pi/telemetry/* .pi/verification/*
rm -f .pi/batch-state.json .pi/batch-history.json
```

### Step 5: Verify clean state

- `find .pi/tasks -name ".DONE" | wc -l` should be `0`
- `git worktree list --porcelain | grep "^worktree"` should show only the main repo worktree
- No stale task, orch, or saved branches should remain

### Step 6: Resume batch with correct state logic

After reset, check the batch state before calling `orch_resume()`:

```bash
# Decision matrix for when to resume:
# - phase == "stopped" AND currentWaveIndex < totalWaves-1 → resume
# - phase == "executing" AND has running tasks → wait (don't resume)
# - phase == "stopped" AND all tasks terminal → done, integrate or skip
```

Only call `orch_resume()` when:
- Phase is stopped AND wave is incomplete
- OR force=true to retry failed tasks

After resume, poll until:
- All tasks reach terminal status (succeeded/failed/skipped)
- Phase transitions from "executing" to "stopped" or "idle"

## Notes

- The backup at `.pi/tasks.bak` preserves the original tasks for restoration if needed
- After reset, run `/orch-plan <areas> --sync` to create a fresh batch plan
- This skill is idempotent; repeated runs produce the same clean taskplane state
- **Key fix**: After batch reset, check phase and wave state before resuming. Do not call `orch_resume()` repeatedly if the batch is already in a valid executing state with running tasks.
- **Submodule gitlink**: When submodules are present, ensure they are initialized and their commits are reachable from origin before starting the batch. Use `git submodule status` to verify.
- **Worktree cleanup**: Always remove worktrees and temporary branches during reset. Stale worktrees can cause merge conflicts.
- **TASK-037**: For bugfix loops, use `reset_strategy: full` for the first iteration (clean slate) and `reset_strategy: light` for subsequent iterations (faster reset).