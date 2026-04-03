## Plan Review: Step 3: Worker prompt context

### Verdict: APPROVE

### Summary
The Step 3 plan covers the required outcomes from PROMPT.md: it explicitly includes both execution-repo context and packet-home context in the worker prompt, and it calls out segment DAG context as conditional when available. This is the right granularity for a plan review and is consistent with Step 2’s packet/cwd separation that was already approved. I don’t see a blocking gap that would prevent the step from achieving its intended behavior.

### Issues Found
1. **[Severity: minor]** No blocking issues found.

### Missing Items
- None identified for Step 3 outcomes.

### Suggestions
- When implementing in `extensions/taskplane/lane-runner.ts`, prefer explicit prompt labels for `executionRepoId`, `packetHomeRepoId`, execution `cwd` (`unit.worktreePath`), and packet paths (`unit.packet.*`) so the worker can reliably reason about cross-repo execution.
- For the “if available” DAG item, use a deterministic/compact rendering (e.g., repo list + sorted edges from `unit.task.explicitSegmentDag`) and omit the section cleanly when absent.
- In Step 4 tests, add at least one assertion that the composed worker prompt contains both repo contexts in segment mode to guard against regressions.