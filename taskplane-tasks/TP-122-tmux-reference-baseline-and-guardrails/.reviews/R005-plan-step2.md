## Plan Review: Step 2: Add regression guard test

### Verdict: APPROVE

### Summary
The Step 2 plan in `STATUS.md` (lines 30–32) is outcome-aligned with the task prompt: it adds the new guard test file, checks for zero functional TMUX execution usage in `extensions/taskplane/*.ts`, and verifies the audit output remains parseable/deterministic. It also builds correctly on the Step 1 contracts already established (strict mode boundary + deterministic JSON contract), so I do not see blockers to implementation.

### Issues Found
1. **[Severity: minor]** — No blocking plan gaps identified for Step 2 outcomes.

### Missing Items
- None blocking.

### Suggestions
- In the test, run `scripts/tmux-reference-audit.mjs` at least twice and compare parsed JSON objects for deterministic equality (not just string equality), to stay resilient to harmless formatting differences.
- Include a strict-mode assertion (`--strict`) that verifies current tree passes with zero functional matches, since this is the core regression guard goal.
- Keep assertions schema/invariant-focused (required keys, sorted `byFile`, normalized POSIX paths) rather than locking exact reference totals, so follow-up cleanup tasks can proceed without brittle test churn.
