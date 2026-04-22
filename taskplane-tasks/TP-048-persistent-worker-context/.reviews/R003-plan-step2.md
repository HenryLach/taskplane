## Plan Review: Step 2: Update worker prompt for multi-step execution

### Verdict: APPROVE

### Summary
The Step 2 plan is aligned with PROMPT.md outcomes: it replaces single-step worker instructions with all-remaining-steps guidance, includes completion-status step listing, and adds explicit per-step commit plus wrap-up checks. It also includes updating both worker templates, which is necessary to remove conflicting single-step behavior at the system-prompt layer. The scope is appropriately outcome-focused and sufficient for this step.

### Issues Found
1. **[Severity: minor]** — The plan could explicitly call out removing all residual “assigned step only” language in `templates/agents/task-worker.md` to avoid mixed instructions. Suggested fix: treat this as an implementation acceptance check while updating templates.

### Missing Items
- None blocking for Step 2 outcomes.

### Suggestions
- In the worker prompt step list, keep explicit skip markers for completed steps (e.g., `[already complete — skip]`) so resume behavior is unambiguous.
- Ensure `templates/agents/local/task-worker.md` comments stay consistent with persistent-context multi-step execution wording.
