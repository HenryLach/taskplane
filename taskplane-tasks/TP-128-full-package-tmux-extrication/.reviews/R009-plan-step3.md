## Plan Review: Step 3: De-TMUX supervisor templates and primer

### Verdict: APPROVE

### Summary
This Step 3 plan now covers all required outcomes from the task prompt: template cleanup, primer cleanup, and explicit removal of TMUX references from `supervisor.ts` runtime prompt text. The blocking gap I flagged in R008 ("check" vs explicit removal in `supervisor.ts`) has been addressed. The step is appropriately scoped and should achieve the intended de-TMUX outcome for supervisor-facing guidance.

### Issues Found
1. **[Severity: minor]** — No blocking issues found.

### Missing Items
- None.

### Suggestions
- After implementation, run a focused grep on `templates/agents/supervisor.md`, `extensions/taskplane/supervisor-primer.md`, and `extensions/taskplane/supervisor.ts` and record residual counts in `STATUS.md` for traceability before moving to Step 4.
