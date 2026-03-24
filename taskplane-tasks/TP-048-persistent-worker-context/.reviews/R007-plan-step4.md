## Plan Review: Step 4: Integrate reviews with the new loop

### Verdict: REVISE

### Summary
The Step 4 plan is directionally correct on the core outcomes (post-worker per-step reviews, REVISE-driven rework, and preserving review-level/low-risk gating). However, it still misses one blocking migration outcome: explicitly removing the current up-front plan-review sweep. If that path remains, behavior will not match the Step 4 requirement that reviews are driven by per-iteration step completion transitions.

### Issues Found
1. **[Severity: important]** — The plan does not explicitly replace the existing pre-loop plan review flow in `extensions/task-runner.ts` (`executeTask()`, around lines 1989-2013) with transition-based post-worker review triggering. Suggested fix: add a concrete outcome that review execution is **only** tied to `incomplete -> complete` transitions discovered after each worker iteration.

### Missing Items
- Explicitly state removal/relocation of the up-front plan review pass so plan reviews are no longer task-start based.
- Explicitly state that both plan and code reviews run from the same post-worker newly-completed-step handler.

### Suggestions
- Add Step 5 test intent for “no plan review before first worker iteration” to prevent regression back to the old behavior.
- Clarify expected behavior for re-completed steps after REVISE (typically: rerun plan+code review because the step transitioned to complete again).
