# Run Your First Task

This tutorial walks through executing a single task end-to-end using `/orch`.

Running a single task via `/orch` gives you the same infrastructure as a full batch — an isolated git worktree, the web dashboard, inline reviews, and supervisor monitoring — focused on just one task.

## Before You Start

Complete these first:

1. [Install Taskplane](install.md)
2. [Run Your First Orchestration](run-your-first-orchestration.md) *(recommended — shows batch mode first)*

You should have this example task folder:

```text
taskplane-tasks/EXAMPLE-001-hello-world/
├── PROMPT.md
└── STATUS.md
```

If you don't see it, run `taskplane init --preset full` from your project root.

---

## Understand the Task Files

### `PROMPT.md`

`PROMPT.md` is the task specification:

- **Mission** — what the task should accomplish
- **Steps** — ordered checklist of work items
- **Constraints** — scope boundaries, file targets, completion criteria
- **Context** — files to read, dependencies on other tasks

The section above the `---` divider is the immutable task definition. Amendments added during execution go below the divider.

### `STATUS.md`

`STATUS.md` is runtime state and persistent memory across worker iterations:

- Current step and execution status
- Checkbox progress (checked off as work completes)
- Review metadata and verdicts
- Execution log with timestamps
- Discoveries and blockers

Workers update this file after completing each checkbox item. It serves as crash-recovery memory — if a worker's context resets, the next iteration reads STATUS.md to know exactly where to resume.

---

## Run the Task

Start a pi session from your project root:

```bash
pi
```

Inside the pi session, run a single task by passing its PROMPT.md path to `/orch`:

```text
/orch taskplane-tasks/EXAMPLE-001-hello-world/PROMPT.md
```

The orchestrator will:

1. Parse the task's `PROMPT.md`
2. Create an isolated git worktree for execution
3. Spawn a worker agent in the worktree
4. The worker reads `STATUS.md`, finds the first unchecked item, and starts working
5. After each completed checkbox, the worker updates `STATUS.md`
6. At step boundaries, the worker creates checkpoint commits
7. When all steps are complete, the worker creates a `.DONE` file
8. The orchestrator merges the result into the orch branch

Your working branch stays untouched throughout — all changes happen in the isolated worktree.

---

## Monitor Progress

### Via `/orch-status`

While the task is running, check progress:

```text
/orch-status
```

You'll see the batch status with wave and lane information, including step-level progress for your task.

### Via the Dashboard

If you launched the dashboard (`taskplane dashboard` in a separate terminal), open `http://localhost:8099` in your browser. The dashboard shows real-time progress with SSE streaming — lane status, task progress, reviewer activity, and merge results.

---

## Pause and Resume

To pause after the current worker iteration finishes:

```text
/orch-pause
```

To resume:

```text
/orch-resume
```

> The example task is intentionally small and may complete before a pause takes effect. That's normal.

---

## Verify Completion

After the task completes, confirm these artifacts:

1. **`.DONE` file exists** — the authoritative completion marker:

```bash
ls taskplane-tasks/EXAMPLE-001-hello-world/.DONE
```

2. **STATUS.md shows all checkboxes complete** — open the file and verify all items are checked (`- [x]`).

3. **Task deliverables exist** — for the hello-world example, check that `hello-taskplane.md` was created in the worktree and merged to the orch branch.

To bring the completed work into your working branch:

```text
/orch-integrate
```

---

## How the Worker Loop Works

Taskplane uses a **persistent-context execution model**:

- A single worker handles all steps within one context window
- The worker reads `STATUS.md` to determine where to resume
- After each checkbox item, the worker updates `STATUS.md` immediately
- At step boundaries, the worker creates git checkpoint commits
- If the context window fills up, a new worker iteration starts fresh — reading `STATUS.md` to pick up where the previous iteration left off

This design makes execution **resumable and robust against interruption**. STATUS.md is the worker's only memory — everything needed to continue is persisted there.

---

## Troubleshooting

### Task doesn't start

Ensure you're passing the correct path to the PROMPT.md file:

```text
/orch taskplane-tasks/EXAMPLE-001-hello-world/PROMPT.md
```

The path should be relative to the project root.

### `/orch-status` shows no active batch

The task may have already completed. Check for a `.DONE` file in the task folder, or review `STATUS.md` for the final status.

### Worker seems stuck on a step

Use `/orch-status` to inspect detailed progress. If the worker is looping on the same item, check `STATUS.md` in the worktree for blockers or errors logged in the execution log.

### Merge conflicts after completion

If the orch branch has conflicts with your working branch, `/orch-integrate` will guide you through resolution. The merge agent handles most conflicts automatically.

---

## Next Steps

- [Configure Worker & Reviews](../how-to/configure-task-runner.md) — customize worker model, reviewer settings, and context injection
- [Configure Task Orchestrator](../how-to/configure-task-orchestrator.md) — adjust lanes, merge behavior, and batch settings
- [Pause, Resume, or Abort a Batch](../how-to/pause-resume-abort-a-batch.md) — operational control for running batches
