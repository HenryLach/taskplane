# Execution Model (`/task`)

Taskplane task execution is a **fresh-context loop** with file-backed memory.

Core idea:

- each worker iteration starts with fresh model context
- the worker handles **all remaining steps** in a single context
- `STATUS.md` is the persistent execution memory
- progress is checkpointed continuously

---

## Lifecycle overview

```text
/task <PROMPT.md>
  → parse task
  → load or generate STATUS.md
  → iteration loop:
      spawn worker with all remaining steps
      worker works through steps in order, committing at each step boundary
      after worker exits, run reviews for each newly completed step
      if REVISE → mark step incomplete for rework in next iteration
      if all steps complete → break
  → (optional) quality gate review
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

The worker is spawned **once per iteration** and told to work through all
remaining (incomplete) steps in order. This preserves accumulated context across
step boundaries, avoiding the re-hydration cost of spawning a fresh worker per
step.

Each iteration:

1. Identify all incomplete steps
2. Spawn worker with the full list of remaining steps
3. Worker works through steps sequentially, committing at each step boundary
4. Worker exits (naturally, via wrap-up signal, or context limit)
5. Runner determines which steps were newly completed
6. For each newly completed step, run transition reviews (plan + code)
7. If a review returns REVISE, mark the step incomplete for rework
8. If all steps complete, task is done; otherwise start next iteration

### Review levels

- `0`: no review
- `1`: plan review on first completion of a step
- `2+`: plan review + code review on step completion

Reviews are **transition-based**: they run after the worker exits, for each step
that transitioned from incomplete to complete during that iteration. Plan reviews
run only on first completion (not on rework cycles). Code reviews run on every
completion.

**Low-risk step exception:** Step 0 (Preflight) and the final step
(Documentation & Delivery) always skip both plan and code reviews, regardless
of the configured review level. These steps perform file reading and `.DONE`
creation respectively — cross-model review adds overhead without catching
meaningful issues. Middle steps are unaffected by this exception.

---

## Worker iteration loop

Each iteration:

1. Re-read `STATUS.md`
2. Determine all remaining incomplete steps
3. Spawn worker agent with task context + project context + remaining steps list
4. Worker works through steps in order, checking off items and committing per step
5. Worker updates `STATUS.md` and checkpoints changes continuously
6. Runner checks total progress across all steps after worker exits

Guardrails:

- `max_worker_iterations`
- `no_progress_limit` (checked per iteration across all steps)
- context pressure thresholds (`warn_percent`, `kill_percent`)
- optional wall-clock cap (`max_worker_minutes`)

If no progress repeats beyond limit, the task is marked blocked/error.

### Context overflow recovery

If the worker hits the context limit mid-task, it exits and the next iteration
picks up from the first incomplete step via STATUS.md — the same recovery
mechanism as any other worker exit, just triggered by context pressure instead
of natural completion.

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

### Quality gate (opt-in)

When the `quality_gate` config is enabled, a structured review runs after all steps complete but **before** `.DONE` creation. A cross-model review agent evaluates the task output and produces a JSON verdict (`PASS` or `NEEDS_FIXES`) with severity-classified findings.

- **PASS:** `.DONE` is created normally.
- **NEEDS_FIXES:** A remediation cycle begins — a fix agent addresses blocking findings, then the review reruns. This repeats up to the configured cycle limits (`max_review_cycles`, `max_fix_cycles`).
- **Cycles exhausted:** If the maximum cycles are reached without a PASS, the task enters error state. `.DONE` is **not** created.
- **Fail-open:** If the review agent crashes, times out, or produces malformed/missing output, the verdict defaults to PASS so infrastructure failures never block task completion.

When disabled (default), `.DONE` is created immediately after all steps complete — no behavioral change.

See [task-runner.yaml Reference](../reference/configuration/task-runner.yaml.md#quality_gate) for configuration details.

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
