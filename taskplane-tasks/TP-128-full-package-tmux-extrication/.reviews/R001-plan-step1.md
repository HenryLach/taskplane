## Plan Review: Step 1: Remove TMUX from task-runner.ts

### Verdict: APPROVE

### Summary
The Step 1 plan in `STATUS.md` is aligned with the Step 1 requirements in `PROMPT.md` and covers the core outcomes: removing TMUX spawn paths, removing TMUX mode selection, preserving subprocess execution, and updating tests. For a medium-scope removal task, this is sufficient outcome-level planning and does not over-prescribe implementation details. I don’t see blocking gaps for this step.

### Issues Found
1. **[Severity: minor]** No blocking issues found.

### Missing Items
- None.

### Suggestions
- Consider explicitly calling out preservation checks for reviewer/quality-gate flows in subprocess mode, since `extensions/task-runner.ts` currently has many TMUX-linked reviewer paths.
- When updating tests, prioritize replacing TMUX-structure assertions with behavior-level assertions for `/task` subprocess operation so future refactors are less brittle.
