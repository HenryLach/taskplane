## Code Review: Step 3: Testing & Verification

### Verdict: REVISE

### Summary
The new `extensions/tests/state-migration.test.ts` adds strong coverage for v1/v2→v3 migration paths and strict nested v3 validation; that part is solid and passes in isolation (`55/55`). However, two Step 3 outcomes are still not fully verified: true read/write roundtrip preservation (including `exitDiagnostic`) and the runtime "enter paused" behavior for corrupt state. There is also a mismatch between the STATUS claim of full-suite success and current reproducible run results.

### Issues Found
1. **[extensions/tests/state-migration.test.ts:457] [important]** — The "unknown field roundtrip preservation" block does not perform a write/read roundtrip; it only calls `validatePersistedState(...)`.
   - Why it matters: Step 3 requires unknown fields preserved through **read/write** roundtrip, but these assertions stop at parsed-state enrichment (`_extraFields`) and never exercise serialization.
   - Fix: Add a test that validates state, serializes via `serializeBatchState(...)` (or equivalent state write path), parses the output, and asserts unknown top-level fields are still present.

2. **[extensions/tests/state-migration.test.ts:251,457 and taskplane-tasks/TP-030-state-schema-v3-migration/STATUS.md:58] [important]** — `exitDiagnostic` serialization roundtrip is claimed in STATUS, but no such test exists in this step.
   - Why it matters: the migration introduced `exitDiagnostic` as canonical data; only read/validation is tested (`tasks[i].exitDiagnostic` object acceptance), not persistence survival across serialization.
   - Fix: Add an explicit roundtrip assertion where an outcome/task with `exitDiagnostic` is serialized and then revalidated/parsed to confirm field integrity.

3. **[extensions/tests/state-migration.test.ts:504] [important]** — Corrupt-state coverage only tests `analyzeOrchestratorStartupState(...)` recommendation, not the runtime effect that orchestrator state enters `paused` with diagnostic.
   - Why it matters: TP-030 requirement is behavior-level (enter paused, preserve state file, show diagnostic), and recommendation-only tests can miss regressions in the extension handler path.
   - Fix: Add a focused test around the `paused-corrupt` branch in orchestrator handling (extension/resume flow) asserting phase becomes `paused` and diagnostic/error surfaces as expected.

4. **[taskplane-tasks/TP-030-state-schema-v3-migration/STATUS.md:61] [minor]** — STATUS states full suite passed with zero failures, but `cd extensions && npx vitest run` currently fails in this branch due `tests/orch-direct-implementation.test.ts` timeout at 60s.
   - Fix: Re-run with stable CI-equivalent settings (or adjusted timeout), and update STATUS to reflect exact result/known flake status.

### Pattern Violations
- `taskplane-tasks/TP-030-state-schema-v3-migration/STATUS.md:79-87` has duplicated review rows (R003–R007 each repeated). This is non-blocking but reduces status clarity.

### Test Gaps
- Missing read→write→read assertions for unknown top-level field preservation.
- Missing `exitDiagnostic` persistence roundtrip assertion.
- Missing integration-level assertion that corrupt startup path actually mutates runtime state to `paused` (not just returns `paused-corrupt` recommendation).

### Suggestions
- Keep `state-migration.test.ts` focused on migration/validation and add one small companion test in existing orchestrator flow tests for paused-corrupt phase mutation.
- Consider a helper for “persisted-state roundtrip” to avoid duplicated setup when testing unknown fields and `exitDiagnostic` persistence.
