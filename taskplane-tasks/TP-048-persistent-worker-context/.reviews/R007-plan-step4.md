## Plan Review: Step 4: Integrate reviews with the new loop

### Verdict: REVISE

### Summary
The Step 4 plan is close to the required outcome: it captures per-step reviews after worker exit, REVISE-triggered rework, and review-level/low-risk gating. However, it is missing one blocking migration detail from the current implementation: plan reviews are still run up-front before the worker loop. Without explicitly removing that path, Step 4 will not fully match the PROMPT requirement that reviews run after worker exit for newly completed steps.

### Issues Found
1. **[Severity: important]** — The plan does not explicitly replace the existing pre-loop plan-review sweep (currently in `extensions/task-runner.ts` inside `executeTask()`) with post-worker, per-`newlyCompleted` review triggering. Suggested fix: add an explicit outcome to remove/relocate up-front plan reviews so review execution is tied only to `incomplete → complete` transitions after each worker iteration.

### Missing Items
- Explicitly state that review triggering should be **transition-based only** (run when a step newly completes in an iteration), not task-start based.

### Suggestions
- Clarify whether plan review should rerun when a step re-completes after a `REVISE`; if not, track a `planReviewedSteps` set and only rerun code review on rework cycles.
- In Step 5 tests, keep/extend coverage for a single iteration completing multiple steps and verify review ordering and skip behavior per step.
