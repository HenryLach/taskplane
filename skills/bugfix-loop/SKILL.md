---
name: bugfix-loop
version: 1.0.0
description: A structured loop for diagnosing and fixing taskplane bugs. Selects a small task slice, resets the repo to clean state, runs a batch while monitoring against a skill condition, and iterates until the fix is confirmed. Use when investigating recurring failures (e.g., submodule gitlink validation) or validating fixes in the taskplane fork.
---

# Bugfix Loop Skill

A structured loop for diagnosing and fixing taskplane bugs through iterative batch runs. Each iteration:
1. Selects a focused task slice (subset of tasks relevant to the bug)
2. Resets the repo to a known clean state
3. Runs a batch while monitoring for the specific issue
4. Evaluates whether the fix condition is met
5. Iterates until confirmed or exhausted

## Prerequisites

- Taskplane fork is available at `.pi/git/github.com/loopyd/taskplane`
- Project has `.pi/taskplane-config.json` configured
- At least one task exists in `.pi/tasks/`
- Git working tree is clean (or can be made clean)

## Configuration

The skill accepts these parameters:

| Parameter | Description | Default |
|-----------|-------------|---------|
| `task_slice` | Comma-separated list of task IDs or prefixes to include | All tasks |
| `max_iterations` | Maximum number of batch iterations | 5 |
| `fix_condition` | Description of what constitutes a "fixed" state | Merge completes without submodule gitlink errors |
| `reset_strategy` | How to reset: `full` (backup+restore) or `light` (status reset only) | full |
| `monitor_interval` | Seconds between status checks during batch | 5 |

## Usage

When the operator says "start the bugfix loop" or "loop on this issue":

1. **Select task slice**: Identify tasks relevant to the bug (e.g., tasks that touch submodules)
2. **Reset to clean state**: Use `batch-reset` skill or light reset
3. **Run batch**: Start a fresh batch with `/orch all --sync`
4. **Monitor**: Watch for the specific issue (submodule gitlink, merge failure, etc.)
5. **Evaluate**: Check if the fix condition is met
6. **Iterate**: If not fixed, apply changes to the taskplane fork and retry

## Reset Strategies

### Full Reset (`reset_strategy: full`)
- Backup `.pi/tasks/` to `.pi/tasks.bak/`
- Remove all worktrees, branches, and transient state
- Restore tasks from backup
- Clear `.DONE` markers, batch-state.json, telemetry
- Result: Complete clean slate

### Light Reset (`reset_strategy: light`)
- Keep `.pi/tasks/` as-is
- Remove only worktrees and temporary branches
- Clear transient state (runtime, supervisor, telemetry)
- Reset STATUS.md files to Pending
- Result: Faster reset, preserves task configuration

## Monitoring the Fix Condition

The skill monitors for the specific issue by checking:

1. **Batch result**: Did all tasks succeed?
2. **Merge phase**: Did merge complete without errors?
3. **Submodule validation**: Are gitlinks reachable after merge?
4. **Lane outcomes**: Which lanes succeeded/failed?
5. **Error messages**: Does the error match the known pattern?

### Error Pattern Matching

For the submodule gitlink issue, the skill checks for:
```
"Post-merge submodule gitlink validation failed in lane N: <submodule>@<sha> on origin"
```

If this pattern appears consistently across iterations, it confirms a logic error. If it appears intermittently, it may be a transient race condition.

## Iteration Flow

```
┌─────────────┐     ┌──────────────┐     ┌──────────────┐
│  Select      │────▶│  Reset to    │────▶│  Run Batch   │
│  Task Slice  │     │  Clean State │     │  + Monitor   │
└─────────────┘     └──────────────┘     └──────────────┘
                                              │
                                              ▼
┌─────────────┐     ┌──────────────┐     ┌──────────────┐
│  Iterate     │◀────│  Evaluate    │◀────│  Check Fix   │
│  (if not     │     │  Result      │     │  Condition   │
│   fixed)     │     └──────────────┘     └──────────────┘
└─────────────┘            │
                           ▼
                    ┌──────────────┐
                    │  Fix Confirmed│
                    │  or Exhausted │
                    └──────────────┘
```

## Step-by-Step Procedure

### Step 1: Select Task Slice

Identify the tasks most relevant to the bug. For submodule gitlink issues:
- Tasks that modify files in submodules
- Tasks in lanes that consistently fail merge
- Tasks with dependencies on other tasks

Example: `task_slice = "INV-001,DISK-001,TEST-001"` (tasks in lane-2)

### Step 2: Reset to Clean State

Choose the appropriate reset strategy:
- **Full reset**: When starting from scratch or after multiple failed iterations
- **Light reset**: When testing a specific fix without losing task configuration

### Step 3: Run Batch

Start a fresh batch with monitoring:
```bash
/orch all --sync
```

Monitor for:
- Wave execution progress
- Merge phase completion
- Submodule gitlink validation
- Error messages in batch summary

### Step 4: Evaluate Result

Check the batch summary for:
- **Success**: All tasks succeeded, merge completed without errors → Fix confirmed
- **Partial**: Some tasks failed but merge completed → Continue iterating
- **Failure**: Merge failed with same error pattern → Apply fix to taskplane fork

### Step 5: Iterate

If not fixed:
1. Apply changes to the taskplane fork (commit and push)
2. Reset to clean state
3. Run batch again
4. Repeat until max_iterations or fix confirmed

## Skill Condition for Fix

The fix condition is met when:
1. **Merge completes** without submodule gitlink validation errors
2. **All tasks in the slice succeed** (not just "succeeded" but properly committed)
3. **No recurring error pattern** across iterations

For the submodule gitlink issue specifically:
- The error message should change from "Post-merge submodule gitlink validation failed" to "Merge completed successfully"
- Or the same error should appear but with different submodules (indicating progress)
- After 3 consecutive successful merges, the fix is confirmed

## Integration with Other Skills

This skill works alongside:
- **batch-reset**: Provides the reset functionality for each iteration
- **create-taskplane-task**: For creating test tasks during diagnosis
- **taskplane-fork**: For applying fixes to the taskplane extension

## Notes

- The loop is idempotent — repeated runs produce consistent results
- Each iteration should document what changed (fix applied, config updated, etc.)
- The skill can be interrupted at any time and resumed from the last iteration
- **Key insight**: Consistent error patterns across clean-state iterations confirm a logic error; intermittent patterns suggest transient issues

## Example: Submodule Gitlink Bugfix Loop

```
Iteration 1:
  - Task slice: INV-001, DISK-001, TEST-001
  - Reset: full
  - Batch: 3/4 succeeded, merge failed (lane-2 gitlink)
  - Error: BoF3-Data-Doc@c700f9b5 not reachable on origin
  
Iteration 2:
  - Fix: Updated checkSubmoduleCommitReachable in git.ts
  - Reset: light
  - Batch: 3/4 succeeded, merge failed (same error)
  - Confirmed: Logic error, not transient

Iteration 3:
  - Fix: Pushed to taskplane fork
  - Reset: full
  - Batch: 4/4 succeeded, merge completed
  - Result: Fix confirmed
```
