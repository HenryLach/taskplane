## Plan Review: Step 1: Fix defaults to inherit

### Verdict: APPROVE

### Summary
The Step 1 plan covers the required outcomes from PROMPT.md: updating schema defaults to inherit, adding `"inherit"` alias handling in the loader, updating templates, and checking backward compatibility for explicit config values. The scope is appropriately focused for this step and leaves runtime flag behavior to Step 2 as intended. I don’t see any blocking gaps that would prevent Step 1 from succeeding.

### Issues Found
1. **[Severity: minor]** — The alias-normalization item is slightly ambiguous. Ensure `"inherit" -> ""` normalization is applied only to agent model/thinking override fields, not to unrelated fields like `taskRunner.modelFallback` where `"inherit"` is a valid semantic value.

### Missing Items
- None.

### Suggestions
- Add a brief note in Step 1 implementation comments/tests that alias handling should work consistently across JSON config, YAML fallback, and user preferences input paths.
- When validating compatibility, include one explicit check for existing non-empty model/thinking values to confirm no regression in override precedence.
