## Code Review: Step 2: Implement Migration

### Verdict: REVISE

### Summary
The migration work is directionally strong: v1/v2→v3 loading now works, serializer carry-forward was added, and corrupt-state handling no longer auto-deletes state files. However, two contract-level requirements are still not met: corrupt startup does not actually put runtime into `paused`, and malformed v3 files can be silently accepted because required sections are auto-filled. Tightening those behaviors is necessary before this step can be considered complete.

### Issues Found
1. **[extensions/taskplane/extension.ts:783-787] [important]** — `paused-corrupt` only notifies and returns; it never transitions runtime state to `paused`.
   - TP-030 explicitly requires corrupt/unparseable state to enter paused with a diagnostic.
   - Current behavior leaves `orchBatchState.phase` unchanged (typically `idle`), so UI/runtime semantics do not reflect a paused safety stop.
   - **Fix:** In this branch, set paused runtime state (at minimum `orchBatchState.phase = "paused"`, capture diagnostic in `errors`, refresh widget) before returning.

2. **[extensions/taskplane/persistence.ts:361-369,737] [important]** — v3 files missing required `resilience`/`diagnostics` are silently accepted.
   - `upconvertV2toV3()` currently defaults these fields for *all* inputs, including `schemaVersion: 3` objects.
   - This defeats the v3-required-field validation contract: malformed v3 should fail with `STATE_SCHEMA_INVALID`, not be auto-healed.
   - **Fix:** Only apply v3 defaulting when original schema is `< 3`; for native v3 inputs, require these sections to exist and validate strictly.

3. **[extensions/taskplane/persistence.ts:754-791] [important]** — v3 sub-structures are only shallowly validated.
   - `retryCountByScope` values, `repairHistory[]` entry shapes, and `diagnostics.taskExits[*]` summary shapes/types are not validated.
   - This allows structurally invalid diagnostics/resilience data to pass schema validation and be persisted.
   - **Fix:** Add per-entry validation aligned with `ResilienceState`, `PersistedRepairRecord`, and `PersistedTaskExitSummary` contracts.

### Pattern Violations
- Behavior/contract mismatch: status notes and task requirements say corrupt state enters paused, but runtime command handling does not set paused phase.
- Schema contract mismatch: v3 is documented as required-fields schema, but validator currently auto-fills missing required sections for v3 inputs.

### Test Gaps
- Missing regression test for `schemaVersion: 3` state missing `resilience` and/or `diagnostics` (should reject).
- Missing test that `paused-corrupt` path updates in-memory phase/state (not just user message).
- Missing tests for invalid nested v3 payloads (e.g., non-numeric `retryCountByScope` values, malformed `diagnostics.taskExits` summaries).

### Suggestions
- Add a focused migration test file (as planned) that covers strict v3 validation vs. v1/v2 defaulting semantics side-by-side.
- Keep unknown-field preservation scope explicit in tests/docs (top-level only, if that is the intended contract).
