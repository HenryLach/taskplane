# Execution Model (`/task`)

Taskplane task execution is a **fresh-context loop** with file-backed memory.

Core idea:

- each worker iteration starts with fresh model context
- `STATUS.md` is the persistent execution memory
- progress is checkpointed continuously

---

## Lifecycle overview

```text
/task <PROMPT.md>
  → parse task
  → load or generate STATUS.md
  → for each step:
      (optional) plan review
      worker iteration loop
      (optional) code review + revise pass
  → create .DONE
  → complete
```

---

## Phase 1: Task initialization

When `/task` starts:

1. Resolve and parse `PROMPT.md`
2. Load `.pi/task-runner.yaml`
3. Ensure `STATUS.md` exists (generate if missing)
4. Ensure `.reviews/` directory exists
5. Enter `running` phase

If `STATUS.md` already exists, review counter and iteration values are rehydrated.

---

## Phase 2: Step execution

Steps are parsed from `### Step N: ...` headings.

For each step:

1. Mark step in progress in `STATUS.md`
2. Optionally run plan review (`reviewLevel >= 1`)
3. Run worker iteration loop until step complete/error/pause
4. Optionally run code review (`reviewLevel >= 2`)
5. Mark step complete and log execution

### Review levels (current behavior)

- `0`: no review
- `1`: plan review before implementation
- `2+`: plan review + code review

---

## Worker iteration loop

Each iteration:

1. Re-read `STATUS.md`
2. Find first unchecked item in current step
3. Spawn worker agent with task context + project context
4. Worker performs one unit of progress
5. Worker updates `STATUS.md` and checkpoints changes
6. Runner checks whether progress was made

Guardrails:

- `max_worker_iterations`
- `no_progress_limit`
- context pressure thresholds (`warn_percent`, `kill_percent`)
- optional wall-clock cap (`max_worker_minutes`)

If no progress repeats beyond limit, step is marked blocked/error.

---

## STATUS.md as persistent memory

`STATUS.md` is the durable source of truth for:

- current step
- checkbox state
- review counter
- iteration count
- execution log

Because state is on disk, execution can be paused/resumed and recovered across session restarts.

---

## Checkpoint discipline

Taskplane's worker prompt enforces checkpoint behavior:

- complete one checkbox item
- update STATUS checkbox
- commit checkpoint in git

This makes progress granular, auditable, and recoverable.

---

## Pause and resume

- `/task-pause`: sets phase to paused; current iteration finishes first
- `/task-resume`: restarts loop from persisted state

On pi session restart, previously loaded task is restored as paused (if available), then resumed manually.

---

## Completion semantics

A task is complete when runner finishes all steps and writes:

- `<task-folder>/.DONE`

In non-orchestrated mode, task folder may be archived after completion.
In orchestrated mode, runner avoids archive moves and lets orchestrator handle post-merge lifecycle.

---

## Failure semantics

Task can enter `error` phase due to:

- parse failures
- worker/reviewer spawn errors
- no-progress threshold exceeded
- iteration limits exceeded
- explicit runtime errors

Status and logs remain on disk for diagnosis.

---

## Why fresh-context loops

Fresh-context execution reduces state drift and hallucinated memory by forcing each loop to re-ground from files.

Tradeoff:

- more explicit disk updates required
- but stronger determinism/restart safety

---

## Related

- [Task Format Reference](../reference/task-format.md)
- [Commands Reference](../reference/commands.md)
- [Persistence and Resume](persistence-and-resume.md)
