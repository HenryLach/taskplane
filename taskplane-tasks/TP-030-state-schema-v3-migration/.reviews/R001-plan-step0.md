## Plan Review: Step 0: Preflight

### Verdict: REVISE

### Summary
The Step 0 checklist is a good start, but it is too narrow for a high-risk state-schema migration. It currently lists files to read, but misses two critical preflight outcomes: validating the TP-025 dependency path for `TaskExitDiagnostic`, and explicitly identifying existing behavior gaps that conflict with TP-030 requirements. Tightening Step 0 now will reduce rework in Steps 1–2.

### Issues Found
1. **[Severity: important]** — TP-025 dependency verification is missing from the preflight plan.
   - Evidence: `PROMPT.md:27-30` requires TP-025 (`TaskExitDiagnostic type must exist`), but `STATUS.md:15-18` has no checklist item covering diagnostics types.
   - Why it matters: v3 requires promoting `exitDiagnostic` alongside legacy `exitReason`; the canonical type currently lives in `extensions/taskplane/diagnostics.ts:189`.
   - Suggested fix: add a Step 0 checklist item to read `extensions/taskplane/diagnostics.ts` and record the compatibility contract (`exitDiagnostic` + legacy `exitReason`) before schema edits.

2. **[Severity: important]** — The plan does not explicitly call out preflight risk mapping for known behavior mismatches.
   - Evidence: TP-030 requires unknown-field roundtrip preservation and safe corrupt-state handling (`PROMPT.md:70`, `PROMPT.md:80`), but current implementation has hot spots that can violate this:
     - serialization rebuilds a strict object shape (`extensions/taskplane/persistence.ts:847-873`), which can drop unknown fields.
     - invalid/io-error state currently recommends cleanup (`extensions/taskplane/persistence.ts:1222-1229`), conflicting with “never auto-delete corrupt state”.
   - Suggested fix: add a Step 0 outcome to capture these deltas in `STATUS.md` Discoveries/Notes with file+line anchors, so Step 2 migration logic addresses them intentionally.

### Missing Items
- Add `taskplane-tasks/CONTEXT.md` to Step 0 reads (requested in `PROMPT.md:33-35`).
- Add a preflight note identifying test touchpoints (`extensions/tests/orch-state-persistence.test.ts` and planned `extensions/tests/state-migration.test.ts`) so migration validation scope is explicit before implementation.

### Suggestions
- When Step 0 is completed, populate the `STATUS.md` Discoveries table with a short migration matrix: current behavior, required behavior, and target file(s) for each gap.
