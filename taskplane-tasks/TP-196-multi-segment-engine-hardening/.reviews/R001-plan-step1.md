## Plan Review: Step 1: Plan all four fixes

### Verdict: APPROVE

### Summary
The Step 1 plan is cohesive and outcome-focused across all four bundled issues (#462, #502, #503, #508). It defines concrete guard/branching behavior, sequencing rationale, and a clear verification strategy without requiring implementation-level micro-checklists. The cross-issue ordering and interaction notes are sufficient to proceed safely into implementation.

### Issues Found
1. **[Severity: minor]** — No blocking issues found.

### Missing Items
- None identified.

### Suggestions
- When implementing #462 discovery warnings, make sure warning emission is deduplicated or clearly scoped so repeated discovery scans do not create noisy logs in large workspaces.
- In Step 2, preserve a single authoritative `computeSegmentScopeMode(...)` path and avoid leaving any parallel ad-hoc condition checks behind after refactor (especially near post-loop/snapshot code paths called out in Discoveries).
