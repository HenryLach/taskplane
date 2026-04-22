## Plan Review: Step 4: Add Settings TUI submenu

### Verdict: APPROVE

### Summary
The Step 4 plan covers the required outcomes for the Settings TUI addition: automatic extension discovery, per-agent toggle UX, exclusion mapping behavior, and persistence into project `taskplane-config.json`. It is aligned with TP-180’s mission and consistent with the existing layered settings model already used in `settings-tui.ts`. I do not see any blocking gaps that would prevent the step from meeting its stated goal.

### Issues Found
1. **[Severity: minor]** — No blocking issues found.

### Missing Items
- None.

### Suggestions
- Consider explicitly handling the “no discovered extensions” case in the submenu (e.g., informative empty-state message) so users understand why no toggles are shown.
- In Step 5, include at least one test around exclude array write-back behavior for this submenu (toggle off adds exact package; toggle on removes it) to reduce regression risk in future TUI refactors.
