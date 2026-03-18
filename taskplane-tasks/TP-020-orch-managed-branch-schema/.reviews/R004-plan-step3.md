## Plan Review: Step 3: Add Integration Toggle to Settings TUI

### Verdict: REVISE

### Summary
The current Step 3 plan is directionally correct but too thin to be implementation-safe. In `STATUS.md`, it currently has only one generic checkbox (`STATUS.md:48-52`), while the prompt requires a specific field contract for the new toggle (`PROMPT.md:94-100`). Add explicit outcomes and test intent so this step can be executed deterministically without relying on memory.

### Issues Found
1. **[Severity: important]** The plan does not restate the required field contract from the prompt (exact `configPath`, label, control type, enum values, and description), so it is easy to implement an incomplete or mismatched field. Expand Step 3 with those concrete acceptance points from `PROMPT.md:94-100`.
2. **[Severity: important]** The plan does not specify the required `FieldDef` semantics for this new entry (especially `layer`), even though `FieldDef` requires it (`extensions/taskplane/settings-tui.ts:55-67`) and section-level schema tests enforce related constraints (`extensions/tests/settings-tui.test.ts:538-556`). Add an explicit outcome that the new Integration field is an L1 editable toggle with a non-empty `values` list.
3. **[Severity: important]** The plan lacks step-level risk/testing intent for Advanced discoverability behavior. Because Advanced exclusion is driven by `SECTIONS`/covered-path mechanics and verified by tests (`extensions/tests/settings-tui.test.ts:1423-1435`, `1509-1519`), call out that `integration` must not appear in Advanced and that these tests are expected to remain green.

### Missing Items
- Explicit Step 3 acceptance checklist mirroring `PROMPT.md:94-100`.
- Explicit declaration of field layer (`L1`) and insertion in the Orchestrator section field list.
- Targeted test intent for settings TUI constraints (toggle values and Advanced exclusion), not just generic “tests pass.”

### Suggestions
- Add one implementation note that no manual `COVERED_PATHS` edits are needed because it is derived from `SECTIONS`; this helps avoid unnecessary churn.
- Keep the new field adjacent to related orchestrator identity/integration controls for operator clarity.
