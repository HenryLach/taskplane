# Review Loop

Taskplane uses an explicit reviewer loop to reduce single-agent blind spots.

## Why a review loop exists

Worker agents optimize for progress. Reviewers optimize for quality and correctness.

Using a separate reviewer model improves:

- defect detection
- standards compliance
- confidence before merge

---

## Review actors

- **Worker**: implements step checklist items
- **Reviewer**: inspects plan/code and writes structured verdict file

Reviewer output is file-based and must be written to disk for orchestration logic to consume it.

---

## Verdicts

Reviewer verdicts:

- `APPROVE`
- `REVISE`
- `RETHINK`
- `UNAVAILABLE`

Interpretation:

- `APPROVE`: continue to next step
- `REVISE`: worker addresses feedback inline (same context), then proceeds
- `RETHINK`: plan concerns — worker reconsiders approach
- `UNAVAILABLE`: reviewer failed to produce output — worker proceeds with caution

---

## Review levels (task metadata)

Task `Review Level` controls review rigor:

- `0`: no review loop
- `1`: plan review only
- `2`: plan + code review
- `3`: full rigor policy level (project may treat as highest scrutiny)

**Exception:** Step 0 (Preflight) and the final step (Documentation & Delivery)
always skip both plan and code reviews, regardless of review level. These
low-risk steps don't benefit from cross-model review.

---

## Worker-driven inline reviews (v0.9.0+)

Reviews are **worker-driven**: the worker agent invokes the `review_step` tool
at step boundaries, based on the task's review level. The reviewer spawns in
a separate tmux session with full RPC telemetry, and the worker's context is
preserved across the tool call.

```text
Worker executing all steps in one context:

  For each substantive step (not Step 0 or final step):
    if review level ≥ 1:
      call review_step(step=N, type="plan")    → plan feedback
    implement the step
    commit changes
    if review level ≥ 2:
      call review_step(step=N, type="code", baseline=<pre-step SHA>)    → code feedback
      if REVISE: address feedback, commit fixes
    proceed to next step
```

Key behaviors:

- **Worker keeps context** — reviews happen mid-execution via a tool call.
  The worker doesn't lose its accumulated understanding of the codebase.
- **Reviewer spawns in tmux** — named session (e.g., `orch-lane-1-reviewer`)
  with RPC wrapper for structured telemetry. Attachable for operator inspection.
- **REVISE handled inline** — the worker reads the review file in `.reviews/`
  and addresses feedback immediately, in the same context that wrote the code.
- **Plan reviews** run before implementation to catch design issues early.
- **Code reviews** receive a baseline commit SHA so the reviewer sees only
  the step's changes (not the full cumulative diff).
- **Low-risk steps** (Step 0/Preflight and final step) skip all reviews
  automatically — both in the worker's review protocol and as a safety net
  in the tool handler.

### Dashboard visibility

During a review, the dashboard shows a **reviewer sub-row** below the active
task with live metrics: elapsed time, tool count, last tool, cost, and context%.
The worker row shows `[awaiting review]` until the reviewer finishes.

### Orchestrated vs standalone mode

The `review_step` tool is only registered in orchestrated mode (`/orch`).
In standalone `/task` mode, reviews are not available (the `/task` command
is deprecated in favor of `/orch` for all workflows).

---

## Review artifacts

Typical on-disk artifacts:

- `.reviews/` directory in task folder
- `request-R00N.md` — generated review request
- `R00N-plan-stepN.md` / `R00N-code-stepN.md` — reviewer output with verdict
- Review rows appended to `STATUS.md` Reviews table

This keeps the audit trail local to the task.

---

## Design tradeoffs

Benefits:

- catches mistakes before merge
- enforces standards consistently
- worker addresses REVISE feedback with full context (no re-hydration)
- reviewer activity visible in dashboard

Costs:

- additional tokens/time per step
- reviewer model cost (mitigated by skipping low-risk steps)

Projects tune this via review levels and review-cycle limits.

---

## Related

- [Execution Model](execution-model.md)
- [Task Format Reference](../reference/task-format.md)
