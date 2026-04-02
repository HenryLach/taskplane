## Plan Review: Step 2: Dashboard label cleanup

### Verdict: APPROVE

### Summary
The Step 2 plan is outcome-aligned with the PROMPT: it targets dashboard tmux-implying labels/tooltips, explicitly preserves payload/data-shape compatibility, and keeps liveness rendering behavior intact. Given the Step 0 inventory already identified the affected dashboard strings, the scope is clear enough to execute safely. I do not see blocking gaps that would prevent this step from achieving its stated outcomes.

### Issues Found
1. **[Severity: minor]** — The plan does not explicitly restate a terminology mapping for dashboard copy (e.g., lane/agent session wording), which could lead to mixed phrasing. Suggested fix: apply the same wording conventions used in Step 1 to keep extension and dashboard messaging consistent.

### Missing Items
- None blocking for Step 2.

### Suggestions
- As flagged in the Step 1 review, keep a single consistent Runtime V2 phrase set across extension output and dashboard UI.
- During implementation, limit this step to presentation text (labels/tooltips/chips) and avoid renaming compatibility fields such as `tmuxSessions`/`tmuxSessionName` in API payload handling.
- Add a quick post-edit grep check for operator-visible `tmux attach` strings in `dashboard/public/app.js` to confirm only intentional legacy/internal references remain.
