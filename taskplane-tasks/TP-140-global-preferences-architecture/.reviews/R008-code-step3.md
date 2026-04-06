## Code Review: Step 3: Flip config loading precedence

### Verdict: APPROVE

### Summary
The Step 3 implementation correctly flips precedence to **schema defaults → global preferences → project overrides** and preserves deep-merge semantics for sparse project config. `loadProjectConfig()` and `loadLayer1Config()` are both updated consistently, with project overrides now loaded as sparse partials and merged onto a default-seeded baseline. Updated tests in `project-config-loader.test.ts` and `global-preferences.test.ts` validate the new precedence behavior, and the targeted suites pass.

### Issues Found
1. **[N/A] [none]** — No blocking correctness issues found for Step 3 outcomes.

### Pattern Violations
- None identified.

### Test Gaps
- No blocking gaps for Step 3.
- Optional additional coverage: add a focused `loadLayer1Config()` test proving it remains global-preferences-free while still applying sparse project overrides and migration normalization.

### Suggestions
- Minor cleanup: there is a stale/duplicated comment block near the `_projectMigrationDone` declaration in `extensions/taskplane/config-loader.ts` (the old `migrateProjectConfig` doc preface remains even though the function was refactored). Consider tightening that comment for clarity.
