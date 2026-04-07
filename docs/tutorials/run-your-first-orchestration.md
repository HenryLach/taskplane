# Run Your First Orchestration

This tutorial walks through running a batch with `/orch`, reading the execution plan, and controlling batch lifecycle with pause/resume/abort commands.

## Before You Start

Complete this first:

- [Install Taskplane](install.md)

You should already have:

- `.pi/taskplane-config.json`
- default example tasks:
  - `taskplane-tasks/EXAMPLE-001-hello-world/`
  - `taskplane-tasks/EXAMPLE-002-parallel-smoke/`

> **New project?** If you haven't set up Taskplane yet, just run `/orch` with no arguments. The supervisor detects that no configuration exists and walks you through onboarding — project assessment, task area design, git branching, and config generation. See [Commands Reference: /orch](../reference/commands.md#orch-areaspathsall) for details.

---

## Step 1: Understand Task Areas

The orchestrator discovers tasks from **task areas** defined in `.pi/taskplane-config.json`:

```json
{
  "taskRunner": {
    "taskAreas": {
      "general": {
        "path": "taskplane-tasks",
        "prefix": "TP",
        "context": "taskplane-tasks/CONTEXT.md"
      }
    }
  }
}
```

Each area points to a directory containing task folders (for example `TP-001-...`).

---

## Step 2: Preview the Plan

Start pi:

```bash
pi
```

Inside pi, run:

```
/orch-plan all
```

This shows:

- discovery results (pending/completed tasks)
- dependency graph
- computed waves
- lane assignment preview

Use refresh mode to bypass dependency cache:

```
/orch-plan all --refresh
```

---

## Step 3: Launch the Dashboard

In a separate terminal:

```bash
taskplane dashboard
```

Keep it open while running `/orch` so you can watch lanes and task progress live.

---

## Step 4: Start the Batch

The simplest way to start is:

```text
/orch
```

When you have pending tasks and a valid configuration, `/orch` with no arguments detects this state and offers to start a batch. You can confirm and the supervisor takes care of the rest.

Alternatively, start directly with explicit arguments:

```text
/orch all
```

or explicit task paths:

```text
/orch taskplane-tasks/EXAMPLE-001-hello-world/PROMPT.md taskplane-tasks/EXAMPLE-002-parallel-smoke/PROMPT.md
```

You can also orchestrate a single task path for worktree isolation:

```text
/orch taskplane-tasks/EXAMPLE-001-hello-world/PROMPT.md
```

What happens:

1. Task discovery and dependency analysis
2. Wave computation (topological ordering)
3. Lane allocation up to `orchestrator.max_lanes`
4. Per-lane execution in isolated git worktrees
5. Each lane executes its assigned task in an isolated worktree with the worker/reviewer pipeline
6. Merge of successful lane branches into integration branch

---

## Step 5: Monitor Progress

Use:

```text
/orch-status
```

You’ll see batch phase, wave index, task counts (succeeded/failed/skipped/blocked), and elapsed time.

The dashboard shows the same execution from a lane-first visual view.

---

## Step 6: Pause, Resume, Abort

### Pause

```
/orch-pause
```

Behavior:

- Pause is cooperative.
- Lanes finish their current task before stopping.
- Useful for controlled stop without losing checkpointed progress.

### Resume

```
/orch-resume
```

Behavior:

- Reconciles persisted state from `.pi/batch-state.json`
- Reconnects to still-running sessions when possible
- Re-executes interrupted tasks when needed
- Continues at the first incomplete wave

### Abort

Graceful abort:

```
/orch-abort
```

Hard abort (immediate session kill):

```
/orch-abort --hard
```

Abort preserves worktrees/branches for inspection.

---

## What Are Waves, Lanes, and Worktrees?

- **Wave**: a dependency-safe group of tasks that can run in parallel
- **Lane**: one execution slot (worker pipeline) in a wave
- **Worktree**: isolated git checkout for one lane, preventing file conflicts

Flow:

`pending tasks → dependency graph → waves → lanes/worktrees → merge`

---

## Common First-Run Outcomes

### “No pending tasks found”

All discovered tasks are already complete (`.DONE`) or archived.

### Single-task batch

If only one pending task exists, you’ll see one wave/lane. That’s normal.

### Merge pause on conflict

If merge policy is `on_merge_failure: pause`, fix conflicts, then run:

```
/orch-resume
```

---

## Next Step

Continue with:

- [Configure Task Runner](../how-to/configure-task-runner.md)
- [Configure Task Orchestrator](../how-to/configure-task-orchestrator.md)
