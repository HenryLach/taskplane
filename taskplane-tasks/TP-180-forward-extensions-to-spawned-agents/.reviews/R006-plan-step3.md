## Plan Review: Step 3: Wire extensions into all three spawn points

### Verdict: APPROVE

### Summary
The updated Step 3 plan now covers the full outcome surface for TP-180’s spawn wiring: worker, reviewer, and merge paths all receive forwarded extensions with exclusion filtering. It also addresses the previously blocking reviewer-context gap by explicitly threading state root via env for settings resolution instead of relying only on worktree `cwd`.

### Issues Found
1. **[Severity: minor]** — No blocking issues found. The plan is implementation-ready for this step.

### Missing Items
- None.

### Suggestions
- In implementation, use a structured encoding for reviewer exclusions in env (e.g., JSON array) to avoid delimiter/parsing edge cases.
- Add/retain a Step 5 test case where reviewer `cwd` lacks `.pi/settings.json` but forwarded state root contains it, to lock in the orchestrator worktree behavior.
