## Plan Review: Step 1: Define v3 Schema

### Verdict: REVISE

### Summary
The Step 1 plan captures the major v3 additions (resilience, diagnostics, and `exitDiagnostic`) and is directionally correct. However, it leaves two important contract details ambiguous that can cause drift in Step 2: whether `resilience`/`diagnostics` are canonical required v3 sections, and how `exitDiagnostic` will propagate from runtime outcomes into persisted task records. Tightening those outcomes now will prevent migration and serialization rework.

### Issues Found
1. **[Severity: important]** — The plan currently frames `resilience`/`diagnostics` as “all optional for backward compat,” which is ambiguous against the v3 contract.
   - Evidence: `STATUS.md:78` says optional-for-compat; `PROMPT.md:66-67` and roadmap `docs/specifications/taskplane/resilience-and-diagnostics-roadmap.md:466-483` define these as v3 schema sections.
   - Risk: If top-level sections remain optional in canonical v3 state, downstream code will need defensive null handling everywhere and migration behavior may diverge.
   - Suggested fix: Make the Step 1 outcome explicit: canonical v3 `PersistedBatchState` includes required top-level `resilience` and `diagnostics` objects; migration/defaulting handles missing fields from v1/v2 (and optional nested keys where appropriate).

2. **[Severity: important]** — `exitDiagnostic` promotion is listed, but the plan does not explicitly include the runtime-to-persistence contract path.
   - Evidence: serialization builds `PersistedTaskRecord` from `LaneTaskOutcome` (`extensions/taskplane/persistence.ts:768-802`), while `LaneTaskOutcome` currently only exposes `exitReason` (`extensions/taskplane/types.ts:537-547`).
   - Risk: Adding `exitDiagnostic` only to persisted types can still drop diagnostics during serialization.
   - Suggested fix: Add a Step 1 outcome to extend both runtime and persisted task-record contracts in `types.ts` so Step 2 can serialize/roundtrip `exitDiagnostic` consistently.

### Missing Items
- Explicit required-vs-optional field contract for v3 schema sections and nested fields (especially `repairHistory[]` entry shape and `diagnostics.taskExits` value shape).
- Explicit statement that `types.ts` version-history/compatibility comments will be updated for v3 to avoid stale schema documentation.

### Suggestions
- Add a short “v3 type contract” table in `STATUS.md` (field, required?, default source) to guide Step 2 migration implementation.
- Keep `TaskExitDiagnostic` as the canonical type source (avoid duplicating classification/cost field unions in `types.ts`).
