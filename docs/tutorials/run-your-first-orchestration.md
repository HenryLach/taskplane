# Run Your First Orchestration

This tutorial walks through running a batch with `/orch`, reading the execution plan, and controlling batch lifecycle with pause/resume/abort commands.

## Before You Start

Complete these first:

- [Install Taskplane](install.md)
- [Run Your First Task](run-your-first-task.md)

You should already have:

- `.pi/task-runner.yaml`
- `.pi/task-orchestrator.yaml`
- at least one pending task folder with `PROMPT.md` and `STATUS.md`

---

## Step 1: Understand Task Areas

The orchestrator discovers tasks from **task areas** defined in `.pi/task-runner.yaml`:

```yaml
task_areas:
  general:
    path: "taskplane-tasks"
    prefix: "TP"
    context: "taskplane-tasks/CONTEXT.md"
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

## Step 3: Start the Batch

Run:

```
/orch all
```

What happens:

1. Task discovery and dependency analysis
2. Wave computation (topological ordering)
3. Lane allocation up to `orchestrator.max_lanes`
4. Per-lane execution in isolated git worktrees
5. Merge of successful lane branches into integration branch

---

## Step 4: Monitor Progress

Use:

```
/orch-status
```

You’ll see batch phase, wave index, task counts (succeeded/failed/skipped/blocked), and elapsed time.

Optional: launch the dashboard in another terminal:

```bash
taskplane dashboard
```

---

## Step 5: Pause, Resume, Abort

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
