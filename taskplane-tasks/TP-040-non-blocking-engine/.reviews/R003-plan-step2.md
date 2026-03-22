## Plan Review: Step 2: Make Engine Non-Blocking

### Verdict: REVISE

### Summary
The Step 2 plan captures the core direction (detach `/orch` from `await executeOrchBatch()` and keep widget updates callback-driven), and it aligns with TP-040’s non-blocking objective. However, it misses a critical failure-path safeguard for fire-and-forget execution, and it does not explicitly cover the second known blocking entrypoint identified in preflight. Without those additions, the step can leave runtime errors unhandled and still preserve blocking behavior on resume.

### Issues Found
1. **[Severity: critical]** — The plan does not define an async error boundary for detached execution. If `/orch` is changed to fire-and-forget without attaching `.catch(...)`/finalization handling, rejected promises from `executeOrchBatch()` can become unhandled and operator state visibility can drift. **Suggested fix:** add a launch wrapper in `extensions/taskplane/extension.ts` that starts the promise without `await` but always attaches catch/finalization behavior (notify + state/error update + widget refresh).
2. **[Severity: important]** — The plan does not explicitly include non-blocking treatment for `/orch-resume`, even though preflight identified `await resumeOrchBatch()` as a blocking point and Step 3 expects resume to restart async. **Suggested fix:** include `/orch-resume` in Step 2 scope (or explicitly defer with a tracked item tied to Step 3).

### Missing Items
- Explicit detached-promise failure handling path (operator notification + state/widget reconciliation).
- Explicit handling plan for `/orch-resume` non-blocking launch behavior.

### Suggestions
- Use a shared helper (e.g., `startOrchAsync` / `startResumeAsync`) so fire-and-forget + catch behavior is consistent.
- Reword Step 2 implementation notes to focus on detaching callers in `extension.ts`; engine internals can remain async/await-driven.
