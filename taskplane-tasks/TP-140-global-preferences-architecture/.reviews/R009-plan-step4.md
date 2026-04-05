## Plan Review: Step 4: Settings TUI — source badges and save behavior

### Verdict: APPROVE

### Summary
The Step 4 plan covers the required outcome-level behaviors for this phase: two-source badges, global-first save behavior, sparse project override writes, override removal, and field-layer updates. That is sufficient to achieve the prompt’s Settings TUI goals without over-specifying implementation details. Given the preceding Step 3 precedence work is complete, this plan is appropriately scoped to the UI/write-path changes needed next.

### Issues Found
1. **[Severity: minor]** — No blocking gaps identified for Step 4 outcomes.

### Missing Items
- None.

### Suggestions
- Add one explicit line in the step notes that source classification is **presence-based**: `(project)` only when the key exists in project overrides, otherwise `(global)` (including schema-fallback values).
- Keep/add targeted tests in this step for: default destination = global, sparse single-field project writes, and “Remove project override” reverting effective value to global.
- When revising field layers, sanity-check consistency with the expanded `GlobalPreferences` schema so newly global-eligible fields don’t remain accidentally project-only in the TUI.
