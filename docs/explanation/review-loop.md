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

Interpretation:

- `APPROVE`: continue
- `REVISE`: run remediation pass
- `RETHINK`: approach concerns (warning/escalation path)

---

## Review levels (task metadata)

Task `Review Level` controls review rigor:

- `0`: no review loop
- `1`: plan review
- `2`: plan + code review
- `3`: full rigor policy level (project may treat as highest scrutiny)

Current runner behavior applies plan review at `>=1` and code review at `>=2`.

---

## Loop mechanics in task-runner

Per step:

1. Plan review (if enabled)
2. Worker implementation loop
3. Code review (if enabled)
4. If `REVISE`, run additional worker fix pass

Counters/limits:

- `max_review_cycles`
- `review_counter` in `STATUS.md`

---

## Review artifacts

Typical on-disk artifacts:

- `.reviews/` directory in task folder
- review output files containing structured verdict and findings
- review rows appended to `STATUS.md`

This keeps audit trail local to the task.

---

## Design tradeoffs

Benefits:

- catches mistakes before merge
- enforces standards consistently
- provides explainable quality gates

Costs:

- additional tokens/time
- more operational complexity

Projects tune this via review levels and review-cycle limits.

---

## Related

- [Execution Model](execution-model.md)
- [Task Format Reference](../reference/task-format.md)
