# Run Your First Task

This tutorial walks through executing the built-in example task end-to-end with `/task`.

## Before You Start

Make sure you already completed:

- [Install Taskplane](install.md)
- `taskplane init --preset full` (or interactive `taskplane init`)

You should have this folder:

```text
taskplane-tasks/EXAMPLE-001-hello-world/
├── PROMPT.md
└── STATUS.md
```

---

## Understand the Task Files

### `PROMPT.md`

`PROMPT.md` is the task specification:

- Mission and scope
- Step-by-step checklist
- Constraints and completion criteria

Treat the section above the `---` divider as immutable task definition.

### `STATUS.md`

`STATUS.md` is runtime state and persistent memory for worker iterations:

- Current step and execution status
- Checkbox progress
- Review metadata
- Execution log

Workers update this file after each checkbox completion.

---

## Start pi and Run the Task

From project root:

```bash
pi
```

Inside pi:

```
/task taskplane-tasks/EXAMPLE-001-hello-world/PROMPT.md
```

The task runner will:

1. Parse `PROMPT.md`
2. Load `STATUS.md`
3. Spawn a worker in a fresh context
4. Execute checklist items one by one
5. Update `STATUS.md` after each completed item
6. Create checkpoint commits as progress is made
7. Mark completion by creating `.DONE`

---

## Check Progress

While the task is running (or after it completes), run:

```
/task-status
```

You should see step-level progress with counts like:

- `Step 0: ... (2/2)`
- `Step 1: ... (2/2)`

---

## Pause and Resume

To pause after the current worker iteration:

```
/task-pause
```

To continue:

```
/task-resume
```

> Note: the example task is intentionally small and may complete quickly before pause takes effect. That’s normal.

---

## Verify Completion

After completion, confirm these artifacts exist:

- `hello-taskplane.md` (project root)
- `taskplane-tasks/EXAMPLE-001-hello-world/.DONE`

Quick check from shell:

```bash
ls hello-taskplane.md taskplane-tasks/EXAMPLE-001-hello-world/.DONE
```

You can also open `STATUS.md` and verify checkboxes are marked complete.

---

## How the Worker Loop Works

Taskplane's `/task` runner uses a fresh-context execution model:

- Each worker iteration starts with no memory
- Worker rehydrates from `STATUS.md`
- Worker resumes at the first unchecked checkbox
- After each checkbox, worker updates `STATUS.md` and checkpoints to git
- Loop continues until completion criteria are met

This design makes execution resumable and robust against interruption.

---

## Troubleshooting

### `No task loaded. Use /task <path/to/PROMPT.md>`

Run `/task ...` first, then `/task-status`.

### `File not found` when running `/task`

Ensure you run from the project root and use the correct path:

```
/task taskplane-tasks/EXAMPLE-001-hello-world/PROMPT.md
```

### Task seems stuck

Use `/task-status` to inspect step progress, then `/task-pause` + `/task-resume`.

---

## Next Step

Continue to: **[Run Your First Orchestration](run-your-first-orchestration.md)**
