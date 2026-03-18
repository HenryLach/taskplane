## Plan Review: Step 3: Add Integration Toggle to Settings TUI

### Verdict: REVISE

### Summary
The current Step 3 plan is too minimal to execute safely. `STATUS.md` only states a generic checkbox for adding the toggle (`taskplane-tasks/TP-020-orch-managed-branch-schema/STATUS.md:48-51`), but the prompt requires a specific field contract (`taskplane-tasks/TP-020-orch-managed-branch-schema/PROMPT.md:94-100`). Add explicit outcomes and test intent so the implementation is deterministic and reviewable.

### Issues Found
1. **[Severity: important]** The plan does not include the required field contract details (exact `configPath`, `label`, `control`, `fieldType`, `values`, and `description`) from the prompt (`taskplane-tasks/TP-020-orch-managed-branch-schema/PROMPT.md:94-100`). Without these in Step 3 acceptance criteria, a partial/misaligned field definition is easy to ship.
2. **[Severity: important]** The plan omits required `FieldDef` semantics for this toggle, especially `layer` and non-empty `values` (`extensions/taskplane/settings-tui.ts:55-67`). These are enforced by section-schema tests (`extensions/tests/settings-tui.test.ts:538-554`), so they should be explicitly included in the step outcome.
3. **[Severity: important]** The plan does not state the Advanced discoverability expectation: once editable, `orchestrator.orchestrator.integration` must be excluded from Advanced via `SECTIONS`/covered paths behavior. This is covered by existing tests (`extensions/tests/settings-tui.test.ts:1423-1435`, `1509-1519`) and should be called out as required validation intent.

### Missing Items
- A concrete Step 3 checklist mirroring `PROMPT.md:94-100`.
- Explicit declaration that this field is editable L1 and belongs in the Orchestrator section list.
- Step-level testing intent for both toggle-shape constraints and Advanced exclusion behavior.

### Suggestions
- Add a short implementation note that `COVERED_PATHS` is derived from `SECTIONS`, so no manual covered-path updates are needed.
- Keep Integration adjacent to existing orchestrator identity/control fields for operator clarity.
