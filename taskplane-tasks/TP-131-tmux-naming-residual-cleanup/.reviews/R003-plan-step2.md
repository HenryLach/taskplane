## Plan Review: Step 2: Dashboard server cleanup

### Verdict: APPROVE

### Summary
The Step 2 plan now covers the required server-side outcomes from `PROMPT.md`, including API field transition, TMUX-stub cleanup, pane endpoint handling, and comment normalization. It also addresses the prior blocking gap by explicitly adding `/api/state` compatibility transition work (`sessions` + legacy `tmuxSessions`). As written, this plan should achieve the step outcome without breaking active dashboard consumers.

### Issues Found
1. **[Severity: minor]** — No blocking issues found for Step 2 scope.

### Missing Items
- None.

### Suggestions
- Before removing `/api/pane/*`, capture grep evidence that no in-repo client still calls it (or choose a rename/deprecation path if any consumer appears).
- When adding the compatibility transition, include a brief TODO/comment describing eventual legacy `tmuxSessions` removal criteria to avoid indefinite dual-field drift.
