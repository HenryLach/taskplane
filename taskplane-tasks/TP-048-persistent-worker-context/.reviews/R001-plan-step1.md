## Plan Review: Step 1: Restructure the step loop to spawn worker once per task

### Verdict: APPROVE

### Summary
The Step 1 plan captures the core structural shift needed in `extensions/task-runner.ts` from a per-step worker loop (`executeStep`/`runWorker(step, ...)`) to a per-task iteration loop in `executeTask`. It also includes the key recovery behaviors: prompting with remaining steps, detecting completed steps after worker exit, and preserving wrap-up/kill safety mechanisms. The proposed scope is outcome-focused and aligned with the task prompt without over-specifying implementation details.

### Issues Found
1. **[Severity: minor]** — The plan does not explicitly call out recomputing the “remaining steps” set from fresh `STATUS.md` on every iteration (vs. computing once). Suggest making this explicit to ensure future REVISE/rework flows (Step 4) are naturally supported.

### Missing Items
- None blocking for Step 1 outcomes.

### Suggestions
- Add a brief note that iteration-level loop state should continue updating operator-facing fields (`Iteration`, `Current Step`/step context) in `STATUS.md` for visibility parity with the current flow in `extensions/task-runner.ts`.
- When implementing, keep the old `executeStep` responsibilities split cleanly (loop control in task-level runner, step-specific review handling in Step 4) to reduce regression risk.
