## Plan Review: Step 1: Remove abort TMUX fallbacks

### Verdict: APPROVE

### Summary
The revised Step 1 plan now covers all abort-related TMUX fallback surfaces identified in preflight, including the previously missing `waitForSessionExit` liveness polling in `abort.ts`. Scope is aligned with the task prompt and cleanly separated from Step 2 (resume) and Step 3 (helper deletion). This should achieve the Step 1 outcomes without forcing premature helper removal.

### Issues Found
1. **[Severity: minor]** — No blocking issues found.

### Missing Items
- None for Step 1 outcomes.

### Suggestions
- Keep the planned grep sweep (`tmuxHasSession|tmuxKillSession` across `abort.ts|execution.ts|merge.ts`) as an explicit completion check before marking Step 1 done.
- Add/confirm targeted test intent for graceful vs hard abort cleanup behavior immediately after Step 1 changes, before Step 3 helper deletion.
