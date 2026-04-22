## Code Review: Step 1: Segment frontier in engine

### Verdict: APPROVE

### Summary
This revision addresses the R002 blocking regression: `task.resolvedRepoId` is now only updated during dispatch when `workspaceConfig` is active (`extensions/taskplane/engine.ts:1391-1393`), preserving repo-mode semantics. The added coverage confirms repo-mode frontier expansion keeps `resolvedRepoId` unset while still producing a fallback segment ID (`extensions/tests/engine-segment-frontier.test.ts:39-46`). I also ran targeted tests (`engine-segment-frontier` + `monorepo-compat-regression`), and they pass.

### Issues Found
1. None.

### Pattern Violations
- None identified.

### Test Gaps
- No blocking gaps for Step 1 outcomes.

### Suggestions
- `extensions/tests/engine-segment-frontier.test.ts:49-52` currently verifies dispatch guarding via source-text regex. Consider replacing this with a behavior-level engine test over time, so refactors don’t cause brittle false negatives while still validating runtime semantics.
