## Plan Review: Step 2: Update worker prompt for multi-step execution

### Verdict: APPROVE

### Summary
The Step 2 plan covers the required outcomes from PROMPT.md: shifting worker instructions from single-step execution to processing all remaining steps in order, including per-step commit behavior and wrap-up checks. It also explicitly includes updating both worker templates, which is necessary to remove conflicting single-step guidance from the system prompt layer. The scope is appropriately outcome-focused and does not over-specify implementation details.

### Issues Found
1. **[Severity: minor]** — The plan could more explicitly call out removing all stale “assigned step only” language in `templates/agents/task-worker.md` (resume algorithm + scope rules), not just updating general wording. Suggested fix: make this an explicit acceptance note while implementing the template update.

### Missing Items
- None blocking for Step 2 outcomes.

### Suggestions
- When implementing “completion status” in the step list, include clear skip semantics for already complete steps (e.g., `already complete — skip`) so resumed iterations are unambiguous.
- In `templates/agents/local/task-worker.md`, update the explanatory comments to reflect the new multi-step/persistent-context behavior (currently phrased as fresh-context loop behavior).
