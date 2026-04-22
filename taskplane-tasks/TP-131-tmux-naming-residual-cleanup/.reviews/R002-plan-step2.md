## Plan Review: Step 2: Dashboard server cleanup

### Verdict: REVISE

### Summary
The Step 2 plan covers the core cleanup targets in `dashboard/server.cjs` (API field rename, TMUX stub cleanup, pane endpoint cleanup, and comment normalization). However, it does not explicitly preserve or validate API compatibility during the `tmuxSessions` → `sessions` transition, which is a stated constraint in `PROMPT.md` and is currently relevant because the frontend has already moved to `data.sessions`. This needs one explicit outcome added so the step cannot accidentally break active consumers.

### Issues Found
1. **[Severity: important]** — Compatibility handling for `/api/state` is underspecified. The plan says “Rename `tmuxSessions` → `sessions` in API response,” but does not require either (a) temporary dual-field emission (`sessions` + legacy `tmuxSessions`) or (b) explicit proof no consumers still read `tmuxSessions` before removal. Suggested fix: add a checklist item to implement and document a transitional compatibility strategy in `dashboard/server.cjs` (around current `buildDashboardState()` return shape, ~lines 1032/1049/1111).

### Missing Items
- Explicit API contract transition outcome for `tmuxSessions` → `sessions` (dual-field period or verified safe removal criteria).

### Suggestions
- Given `/api/pane/*` appears unused in-repo, include a quick grep-based verification note before removal (to satisfy the “if unused” condition with evidence).
- When replacing TMUX wording in comments, keep “lane session ID/prefix” terminology consistent across telemetry sections to avoid mixed naming in future maintenance.
