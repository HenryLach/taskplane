## Plan Review: Step 0: Preflight

### Verdict: REVISE

### Summary
The Step 0 plan is directionally correct but under-scoped for this task’s risk level. It currently tracks only two reads, and misses key preflight outcomes that directly affect later implementation choices for init v2.

### Issues Found
1. **[Severity: important]** — The plan does not include a concrete outcome for spec source resolution even though Step 0 depends on spec sections (`STATUS.md:20-21`, `PROMPT.md:54`). Add an explicit check to locate/read the onboarding spec and record the source used (or blocker) before Step 1 starts.
2. **[Severity: important]** — The plan omits verification of the TP-014 JSON loader contract, despite this task requiring JSON config output via TP-014 (`PROMPT.md:23`, `PROMPT.md:29`). Add a preflight outcome to review current loader/schema expectations (e.g., `extensions/taskplane/config-loader.ts`) so init changes stay compatible.

### Missing Items
- A preflight notes entry summarizing current `cmdInit()` behavior that must be preserved (especially `--preset` compatibility and YAML continuity).
- A short validation intent note for later steps (which dry-run/CLI checks will be used to catch regressions).

### Suggestions
- Keep Step 0 outcome-level, but add 1-2 risk-mitigation outcomes tied to dependency and spec availability.
