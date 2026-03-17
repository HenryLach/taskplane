## Plan Review: Step 3: Legacy Config Migration Warning

### Verdict: APPROVE

### Summary
The Step 3 plan is appropriately scoped and outcome-focused: detect the legacy YAML-only state and emit a clear migration warning that points users to `/settings`. It aligns with the PROMPT spec and STATUS context, and preserves the doctor command’s read-only diagnostic contract. This is a low-risk incremental addition to existing doctor checks.

### Issues Found
1. **[Severity: minor]** — The plan does not explicitly state whether the warning should apply in both single-repo and workspace mode. Suggested fix: clarify that detection should run wherever project config files are evaluated (or explicitly document mode constraints).

### Missing Items
- A brief testing intent for edge cases would strengthen the step (e.g., YAML+JSON both present should not warn, YAML missing should not warn).

### Suggestions
- Keep warning text exact and stable (`Legacy YAML config detected. Use /settings to migrate.`) so future tests/assertions can match reliably.
- Reuse existing config path resolution/helpers in `cmdDoctor()` to avoid mode-specific drift.