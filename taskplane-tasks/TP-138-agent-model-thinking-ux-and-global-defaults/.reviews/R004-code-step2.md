## Code Review: Step 2: Audit and fix runtime fallbacks

### Verdict: APPROVE

### Summary
Step 2 is implemented correctly and meets the stated runtime fallback goals. As flagged in the Step 2 plan review, the `/task` audit now covers all relevant spawn paths in `task-runner.ts` (worker, reviewer, quality gate reviewer, and fix agent), and `spawnAgent` now omits `--model` / `--thinking` when values are empty so session defaults can be inherited. The targeted regression tests for task-runner, lane-runner, and agent-host all pass.

### Issues Found
1. None blocking.

### Pattern Violations
- None identified.

### Test Gaps
- Optional: add one explicit assertion for merge-agent wiring (`extensions/taskplane/merge.ts`) to lock in the “empty thinking/model => omitted flags” contract in the same way as lane-runner and agent-host.

### Suggestions
- Optional hardening: add focused coverage for quality-gate/fix-agent spawn paths in `task-runner.ts` so future edits don’t accidentally reintroduce explicit fallback flags there.
- Consider adding a small integration-style test that verifies effective CLI args produced by `task-runner` spawn construction (not just source-string matching), to reduce brittleness of static text assertions over time.
