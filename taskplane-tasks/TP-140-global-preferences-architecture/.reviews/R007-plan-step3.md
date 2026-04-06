## Plan Review: Step 3: Flip config loading precedence

### Verdict: APPROVE

### Summary
The Step 3 plan covers the core required outcomes for this phase: flipping precedence to schema → global → project, treating project config as sparse overrides with deep merge semantics, updating `loadLayer1Config()` consistently, and updating tests for the new behavior. At outcome level, this is sufficient to proceed and should achieve the step goals without forcing implementation-level micromanagement. Relative to earlier Step 2 planning concerns, the current plan remains appropriately focused on compatibility and merge semantics.

### Issues Found
1. **[Severity: minor]** — No blocking gaps identified for Step 3 outcomes.

### Missing Items
- None.

### Suggestions
- Add at least one explicit test intent for `loadLayer1Config()` proving it remains Layer-1-only (no global preference application).
- During implementation, be careful to preserve legacy migration behavior (`tmuxPrefix`/`spawnMode`) when changing merge order, so compatibility does not regress.
- Keep `normalizeInheritanceAliases()` explicitly at the end of the final assembled config path (as called out in PROMPT Step 3).