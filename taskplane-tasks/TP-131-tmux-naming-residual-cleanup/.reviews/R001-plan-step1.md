## Plan Review: Step 1: Dashboard frontend cleanup

### Verdict: APPROVE

### Summary
The Step 1 plan is aligned with the PROMPT requirements for frontend cleanup: it covers variable renames in `app.js`, TMUX-specific liveness comment updates, CSS class renaming in `style.css`, and updating corresponding references. The scope is appropriate for an S-sized cosmetic refactor and keeps behavior-preserving intent clear.

### Issues Found
1. **[Severity: minor]** — The plan does not explicitly call out transitional API compatibility in the frontend (`sessions` vs legacy `tmuxSessions`) while Step 2 is still pending. Suggested fix: when renaming, keep a temporary read fallback (`data.sessions ?? data.tmuxSessions ?? []`) to avoid accidental interim regressions.

### Missing Items
- None blocking for Step 1 outcomes.

### Suggestions
- Include a quick grep-based acceptance check for this step (e.g., no remaining `tmux-` CSS class usage in `dashboard/public/*` except intentional legacy references) before moving to Step 2.
- While editing comments, also normalize non-liveness TMUX wording in `app.js` doc/comments if touched, so frontend naming is consistently neutral in one pass.
