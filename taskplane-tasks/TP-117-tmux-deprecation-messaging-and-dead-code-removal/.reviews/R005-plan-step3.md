## Plan Review: Step 3: Remove dead session helpers

### Verdict: APPROVE

### Summary
The Step 3 plan is aligned with PROMPT.md outcomes: audit `sessions.ts`, remove only truly dead helpers, and preserve anything still needed for abort/cleanup behavior. Based on the Step 0 inventory, this is likely a mostly no-op step (with only minor cleanup), and the current plan is sufficient to achieve that safely. I don’t see blocking gaps that would require re-planning.

### Issues Found
1. **[Severity: minor]** — No blocking issues found in the plan for this step.

### Missing Items
- None identified.

### Suggestions
- If the audit confirms there are no dead exported session helpers, explicitly record that outcome in STATUS.md so Step 3 is clearly complete-by-verification.
- Include a quick reference grep before closing the step to confirm `listOrchSessions`/`formatOrchSessions` remain used and abort-related TMUX helpers are untouched.
- Consider removing the currently unused `join` import in `extensions/taskplane/sessions.ts` as opportunistic cleanup during this step.
