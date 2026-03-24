# Execution Model

Taskplane task execution is a **persistent-context loop** with file-backed memory.

Core idea:

- each worker iteration starts with fresh model context
- the worker handles **all remaining steps** in a single context
- the worker drives reviews inline via the `review_step` tool
- `STATUS.md` is the persistent execution memory
- progress is checkpointed continuously

---

## Lifecycle overview

```text
/orch <task or area>
  → allocate lane (isolated git worktree)
  → parse task
  → load or generate STATUS.md
  → iteration loop:
      spawn worker with all remaining steps
      worker works through steps in order:
        - plan review (via review_step tool, if level ≥ 1)
        - implement step
        - commit changes
        - code review (via review_step tool, if level ≥ 2)
        - if REVISE: address feedback, commit fixes
        - proceed to next step
      after worker exits, check what was completed
      if all steps complete → break
      if context limit hit → next iteration picks up from incomplete step
  → (optional) quality gate review
  → create .DONE
  → merge into orch branch
```

---

## Phase 1: Task initialization

When a task starts executing in a lane:

1. Resolve and parse `PROMPT.md`
2. Load config (JSON first, YAML fallback)
3. Ensure `STATUS.md` exists (generate if missing)
4. Ensure `.reviews/` directory exists
5. Enter `running` phase
6. Context window auto-detected from pi model registry (v0.8.0+)

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
3. Worker works through steps sequentially:
   - Calls `review_step(type="plan")` before implementing (if review level ≥ 1)
   - Implements the step
   - Commits at step boundary
   - Calls `review_step(type="code")` after implementing (if review level ≥ 2)
   - If REVISE: reads feedback, addresses issues, commits fixes
   - Proceeds to next step
4. Worker exits (naturally, via wrap-up signal, or context limit)
5. Runner determines which steps were newly completed
6. If all steps complete, task is done; otherwise start next iteration

### Worker-driven reviews (v0.9.0+)

Reviews are driven by the **worker agent** via the `review_step` extension tool.
The worker decides when to review based on the task's review level. The reviewer
spawns in a separate tmux session with full RPC telemetry and the worker's
context is preserved across the tool call.

- **Review Level 0:** No reviews
- **Review Level 1:** Plan review before implementing each step
- **Review Level 2:** Plan review + code review after implementing
- **Review Level 3:** Plan + code + test reviews

**Low-risk step exception:** Step 0 (Preflight) and the final step
(Documentation & Delivery) always skip reviews. The worker template instructs
this and the tool handler enforces it as a safety net.

See [Review Loop](review-loop.md) for full details.

---

## Worker iteration loop

Each iteration:

1. Re-read `STATUS.md`
2. Determine all remaining incomplete steps
3. Spawn worker agent with task context + project context + remaining steps list
4. Worker works through steps in order, invoking reviews inline
5. Worker updates `STATUS.md` and checkpoints changes continuously
6. Runner checks total progress across all steps after worker exits

Guardrails:

- `max_worker_iterations`
- `no_progress_limit` (checked per iteration across all steps)
- context pressure thresholds (`warn_percent` default 85%, `kill_percent` default 95%)
- optional wall-clock cap (`max_worker_minutes`, default 120 min)

If no progress repeats beyond limit, the task is marked blocked/error.

### Context window auto-detect (v0.8.0+)

The worker's context window is auto-detected from pi's model registry. For
Claude 4.6 Opus, this is 1M tokens; for Bedrock variants, 200K. The hardcoded
200K default is only a fallback when pi doesn't report the model's context size.
Users can still override via `worker_context_window` in config.

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
- commit checkpoint at step boundaries

This makes progress granular, auditable, and recoverable.

---

## Pause and resume

- `/orch-pause`: sets pause signal; current tasks finish before pausing
- `/orch-resume [--force]`: restarts from persisted state
- On batch failure, the supervisor can resume programmatically via the `orch_resume` tool

---

## Completion semantics

A task is complete when the worker finishes all steps and writes:

- `<task-folder>/.DONE`

### Quality gate (opt-in)

When the `quality_gate` config is enabled, a structured review runs after all steps complete but **before** `.DONE` creation. A cross-model review agent evaluates the task output and produces a JSON verdict (`PASS` or `NEEDS_FIXES`) with severity-classified findings.

- **PASS:** `.DONE` is created normally.
- **NEEDS_FIXES:** A remediation cycle begins — a fix agent addresses blocking findings, then the review reruns. This repeats up to the configured cycle limits (`max_review_cycles`, `max_fix_cycles`).
- **Cycles exhausted:** If the maximum cycles are reached without a PASS, the task enters error state. `.DONE` is **not** created.
- **Fail-open:** If the review agent crashes, times out, or produces malformed/missing output, the verdict defaults to PASS so infrastructure failures never block task completion.

When disabled (default), `.DONE` is created immediately after all steps complete — no behavioral change.

See [task-runner.yaml Reference](../reference/configuration/task-runner.yaml.md#quality_gate) for configuration details.

In orchestrated mode, the runner creates `.DONE` and lets the orchestrator handle post-merge lifecycle.

---

## Failure semantics

Tasks can enter `error` phase due to:

- parse failures
- worker/reviewer spawn errors
- no-progress threshold exceeded
- iteration limits exceeded
- explicit runtime errors

Status and logs remain on disk for diagnosis. The supervisor agent can diagnose failures and offer recovery options.

---

## Why persistent-context loops

The persistent-context model (v0.8.0+) spawns one worker per task instead of
per step. The worker maintains full context across step boundaries, eliminating
costly re-hydration. If the context window is exhausted mid-task, the iteration
mechanism provides a clean recovery path via STATUS.md.

Tradeoff:

- workers use more of the context window per iteration
- but dramatically fewer spawns and lower token cost
- reviews happen inline with full context (worker addresses REVISE immediately)

---

## Related

- [Review Loop](review-loop.md)
- [Task Format Reference](../reference/task-format.md)
- [Commands Reference](../reference/commands.md)
- [Persistence and Resume](persistence-and-resume.md)
