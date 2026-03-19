## Code Review: Step 1: Define v3 Schema

### Verdict: REVISE

### Summary
The type-level v3 additions in `extensions/taskplane/types.ts` are directionally correct (new resilience/diagnostics sections and `exitDiagnostic` promotion), but this step introduces runtime compatibility regressions by bumping the schema constant without corresponding validator/serializer updates. In its current state, existing v2 persisted files are rejected and emitted v3 state can be structurally incomplete versus the declared v3 contract. This must be corrected before proceeding.

### Issues Found
1. **[extensions/taskplane/persistence.ts:381-382] [critical]** — v2 state files are now rejected.
   - `validatePersistedState()` currently accepts only schema `1` and `BATCH_STATE_SCHEMA_VERSION`; after the bump to `3`, schema `2` files fail with `Unsupported schema version 2`.
   - This breaks the stated compatibility contract and resumability for existing users.
   - **Fix:** Accept `2` during transition and implement chained migration (`v1 -> v2 -> v3`) before enforcing stricter validation.

2. **[extensions/taskplane/persistence.ts:847-873, extensions/taskplane/types.ts:1610-1615] [important]** — Serializer writes `schemaVersion: 3` but does not emit required v3 sections.
   - `PersistedBatchState` now requires `resilience` and `diagnostics`, but `serializeBatchState()` omits both.
   - That creates on-disk data claiming v3 while missing declared required fields.
   - **Fix:** Include `resilience: defaultResilienceState()` and `diagnostics: defaultBatchDiagnostics()` in serialization immediately (or keep fields optional until migration/serialization is updated in the same step).

3. **[extensions/taskplane/persistence.ts:340-343] [important]** — `upconvertV1toV2()` no longer matches its contract.
   - It now sets `schemaVersion` to `BATCH_STATE_SCHEMA_VERSION` (3), despite function name/docs/tests indicating v1→v2 behavior.
   - This creates semantic drift and confuses migration ownership.
   - **Fix:** Keep `upconvertV1toV2()` targeting literal `2`, then add a separate `upconvertV2toV3()` and chain explicitly.

### Pattern Violations
- **Contract/code drift:** `types.ts` documents v3 load compatibility and required v3 sections, but current `persistence.ts` behavior still reflects v2 assumptions.

### Test Gaps
- Regression suites currently failing due schema/version behavior mismatch:
  - `extensions/tests/polyrepo-regression.test.ts`
  - `extensions/tests/monorepo-compat-regression.test.ts`
- Repro command used:
  - `cd extensions && npx vitest run tests/polyrepo-regression.test.ts tests/monorepo-compat-regression.test.ts` (15 failing tests)

### Suggestions
- Land schema version bump and persistence migration logic atomically (same checkpoint) to avoid transient breakage of recoverability semantics.
- After Step 2 migration updates, add explicit assertions that v2 fixtures load and round-trip into canonical v3 with defaulted `resilience`/`diagnostics`.
