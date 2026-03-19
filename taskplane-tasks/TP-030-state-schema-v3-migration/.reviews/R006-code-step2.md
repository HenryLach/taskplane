## Code Review: Step 2: Implement Migration

### Verdict: REVISE

### Summary
The migration direction is good (v1/v2→v3 upconversion, corrupt-state no-auto-delete behavior, and roundtrip preservation scaffolding are all present), and the touched tests pass for the updated paths. However, there are still correctness gaps in v3 validation and corrupt-state runtime behavior that can let malformed v3 files pass silently and miss the required paused-state operator signal.

### Issues Found
1. **[extensions/taskplane/persistence.ts:361-369, 736-737] [important]** — v3 files missing required sections are silently accepted.
   - `upconvertV2toV3()` now backfills `resilience`/`diagnostics` for any object, including `schemaVersion: 3`, so malformed v3 state is treated as valid instead of rejected.
   - Repro (passes today, should fail): a v3 state without `resilience`/`diagnostics` is accepted by `validatePersistedState()`.
   - **Fix:** only backfill these sections during true migration (`schemaVersion < 3`), and for `schemaVersion === 3` require presence via validation.

2. **[extensions/taskplane/persistence.ts:754-793] [important]** — v3 nested structures are only shallowly validated.
   - Current checks validate container types but not required inner field types (e.g., `retryCountByScope` values, `repairHistory[]` record shape, `diagnostics.taskExits[*]` summary fields).
   - This allows malformed v3 payloads to pass validation and can break downstream logic expecting canonical shapes.
   - **Fix:** add explicit per-entry validation loops for nested objects/arrays and reject malformed records with `STATE_SCHEMA_INVALID`.

3. **[extensions/taskplane/extension.ts:783-787] [important]** — corrupt-state path does not actually enter paused runtime phase.
   - `paused-corrupt` currently only notifies and returns; `orchBatchState.phase` remains unchanged (typically `idle`).
   - Task requirement calls for corrupt/unparseable state to enter paused with diagnostics; without a phase update, operator-visible runtime state/widget does not reflect paused/corrupt status.
   - **Fix:** set orchestrator runtime state to paused-with-error context (e.g., phase + error message), refresh widget, then return.

### Pattern Violations
- Requirement drift: `paused-corrupt` recommendation is introduced, but command-layer handling does not map it to a paused runtime phase.

### Test Gaps
- No regression test that `schemaVersion: 3` missing required `resilience`/`diagnostics` is rejected.
- No regression tests for malformed nested v3 structures (`repairHistory` item shape, `taskExits` entry shape, retry-count value types).
- No integration-level test that `/orch` corrupt-state startup leaves file intact **and** sets paused operator state.

### Suggestions
- Add small validator helpers for v3 sub-shapes to keep `validatePersistedState()` readable while enforcing strict schema guarantees.
