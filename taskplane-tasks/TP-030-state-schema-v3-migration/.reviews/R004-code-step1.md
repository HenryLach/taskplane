## Code Review: Step 1: Define v3 Schema

### Verdict: REVISE

### Summary
The step successfully introduces the core v3 type surface in `extensions/taskplane/types.ts` (resilience, diagnostics, schema bump, and `exitDiagnostic` on both runtime and persisted task records). However, there are still contract inconsistencies in the inline schema documentation that conflict with the new required-v3 shape and current runtime behavior. Tightening those now will prevent Step 2 migration/validation drift.

### Issues Found
1. **[extensions/taskplane/types.ts:1310-1315] [important]** — v3 JSDoc says `resilience`/`diagnostics` are optional, but the actual v3 contract in `PersistedBatchState` marks both as required (`extensions/taskplane/types.ts:1606-1615`).
   - **Fix:** Update the `BATCH_STATE_SCHEMA_VERSION` version-history text to say canonical v3 requires both sections, and v1/v2 migration fills defaults.

2. **[extensions/taskplane/types.ts:1317-1322] [important]** — Compatibility policy JSDoc claims current load/save behavior (`loadBatchState() accepts v1/v2/v3`, `saveBatchState() writes v3`) that is not true yet in runtime code (`extensions/taskplane/persistence.ts:380-386` still rejects v2 once schema constant is 3).
   - **Fix:** Either (a) mark this as pending Step 2 behavior in comments, or (b) align persistence behavior in the same change. As written, docs and behavior diverge.

3. **[extensions/taskplane/types.ts:1249-1250] [minor]** — `retries` is optional in `PersistedTaskExitSummary`, but comment says “0 if never retried,” which implies required numeric normalization.
   - **Fix:** Make `retries` required with default `0`, or update comment to explicitly allow `undefined` when not recorded.

### Pattern Violations
- Inline schema docs currently drift from actual runtime behavior, which violates the project guidance to keep behavior/docs aligned.

### Test Gaps
- No tests were added for new v3 type-contract defaults (`defaultResilienceState()`, `defaultBatchDiagnostics()`).
- Current suite is red after this step (`cd extensions && npx vitest run`): 15 failures (mostly v2 schema compatibility expectations), indicating migration/validation follow-through is still pending.

### Suggestions
- In Step 2, add targeted migration tests that assert canonical v3 shape always contains required `resilience` and `diagnostics` after load/upconvert.
- Add a tiny unit assertion for default factory functions to lock expected conservative defaults.
