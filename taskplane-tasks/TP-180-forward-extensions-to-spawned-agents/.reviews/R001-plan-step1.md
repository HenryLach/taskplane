## Plan Review: Step 1: Create settings-loader utility

### Verdict: APPROVE

### Summary
The Step 1 plan covers the required outcomes from the task prompt: loading project and global settings, honoring `PI_CODING_AGENT_DIR`, deduplicating with project precedence, filtering Taskplane packages, and handling malformed/missing inputs safely. The scope is appropriately focused for a utility-layer step and sets up downstream spawn wiring without over-specifying implementation details. I don’t see any blocking gaps that would prevent Step 1 from succeeding.

### Issues Found
1. **[Severity: minor]** — No blocking issues found.

### Missing Items
- None.

### Suggestions
- Consider explicitly stating that non-string `packages` entries (if encountered) should be ignored rather than propagated, to avoid passing invalid `-e` values later.
- Consider adding a small helper for global settings path resolution (env override vs homedir default) so Step 3+ call sites can reuse consistent behavior if needed.
