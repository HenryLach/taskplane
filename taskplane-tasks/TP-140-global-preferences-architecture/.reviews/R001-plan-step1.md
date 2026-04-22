## Plan Review: Step 1: Rename user preferences → global preferences

### Verdict: APPROVE

### Summary
The Step 1 plan is appropriately scoped for a rename-only pass and aligns with the TP-140 requirements for terminology migration. It clearly covers the key API/type renames, reference updates, and a targeted test pass to catch regressions from symbol changes. This is sufficient to achieve the step outcome before semantic merge/precedence work in later steps.

### Issues Found
1. **[Severity: minor]** — No blocking issues found for Step 1.

### Missing Items
- None identified for this step’s stated outcome.

### Suggestions
- Add a quick repo-wide verification pass (e.g., grep for `UserPreferences`, `loadUserPreferences`, `resolveUserPreferencesPath`) as an explicit completion check so no stale naming remains in comments/tests/docs-in-code.
- If `applyUserPreferences()` logic is intentionally deferred, keep a temporary compatibility alias or do all call-site renames in the same commit to avoid transient compile failures between Step 1 and Step 2.
