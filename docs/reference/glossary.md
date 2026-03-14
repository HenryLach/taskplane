# Glossary

## Batch
A full `/orch` execution run across one or more waves.

## Blocked task
A task that cannot run because required dependencies failed or were skipped.

## Checkpoint
A persisted unit of progress (STATUS update + commit) created during task execution.

## Dependency graph (DAG)
Directed graph of task dependencies used to compute execution waves.

## Fresh-context loop
Task-runner model where each worker iteration starts with fresh context and rehydrates from files.

## Integration branch
Target branch that successful lane branches are merged into (configured in orchestrator config).

## Lane
One parallel execution slot in orchestration, mapped to a worktree/session.

## Merge agent
Agent responsible for merging lane branches and running verification.

## Reconciliation
Resume-time process that compares persisted state with live signals (`.DONE`, sessions) to decide next actions.

## Resume
Continuation of an interrupted batch/task using persisted state.

## Reviewer
Independent review agent that evaluates plan/code and emits verdicts (APPROVE/REVISE/RETHINK).

## Sidecar file
Auxiliary state file under `.pi/` used for dashboard/monitoring (for example lane state files).

## Skipped task
Task intentionally not executed due to policy or dependency outcomes.

## STATUS.md
Per-task execution memory file tracking step/checkbox progress and logs.

## Task area
Configured domain/path containing task folders, defined in `task-runner.yaml`.

## Task worker
Execution agent that implements checklist items and updates STATUS.

## Wave
Dependency-safe group of tasks that can execute in parallel.

## Worktree
Isolated git checkout used by a lane to avoid parallel file conflicts.
