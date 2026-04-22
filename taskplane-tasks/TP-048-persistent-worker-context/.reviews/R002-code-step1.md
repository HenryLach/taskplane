## Code Review: Step 1: Restructure the step loop to spawn worker once per task

### Verdict: REVISE

### Summary
The refactor correctly moves worker spawning to a task-level iteration loop and passes remaining steps into a single worker prompt, which matches the Step 1 intent. However, two blocking regressions were introduced: the task can be marked complete even when steps remain incomplete, and per-step code review diffs are no longer scoped to each step’s actual work window. These need fixes before this step is considered safe.

### Issues Found
1. **[extensions/task-runner.ts:1992-2104] [critical]** — If the `for (iter < max_worker_iterations)` loop exits by hitting the iteration cap (not by `allComplete`), execution still falls through to the quality gate / `.DONE` path. This can complete the task with unfinished steps. **Fix:** after the iteration loop, re-read `STATUS.md` and hard-fail (set error phase + log + return) when any step is still incomplete; only continue to quality gate when all steps are complete.
2. **[extensions/task-runner.ts:1987,2079] [important]** — `stepBaselineCommits` is captured up-front for all steps before worker execution. For later steps completed in the same task run, `git diff <baseline>..HEAD` includes earlier steps’ commits, so step-level code reviews receive cross-step diffs. **Fix:** capture baselines at step start boundaries (not globally up-front), or derive per-step diff ranges from step-boundary commits (the worker is already instructed to commit per step).

### Pattern Violations
- Step-level review isolation is broken: existing review request semantics assume `Step N` diff reflects that step’s changes, not cumulative prior steps.

### Test Gaps
- Missing regression test: reaching `max_worker_iterations` with incomplete steps must fail and must not create `.DONE`.
- Missing regression test: when one worker iteration completes multiple steps, each step review should receive only that step’s diff scope.

### Suggestions
- Consider not marking every incomplete step as `in-progress` during up-front plan review; mark only the currently active step for clearer STATUS/operator visibility.
