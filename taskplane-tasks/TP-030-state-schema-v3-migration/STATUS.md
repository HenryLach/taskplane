# TP-030: State Schema v3 & Migration — Status

**Current Step:** Step 1: Define v3 Schema
**Status:** 🟡 In Progress
**Last Updated:** 2026-03-19
**Review Level:** 2
**Review Counter:** 3
**Iteration:** 2
**Size:** M

---

### Step 0: Preflight
**Status:** ✅ Complete
- [x] Read CONTEXT.md (Tier 2 context)
- [x] Read current v2 schema in types.ts
- [x] Read persistence read/write flow
- [x] Read resume validation
- [x] Read roadmap Phase 3 section 3a
- [x] Verify TP-025 dependency: confirm TaskExitDiagnostic exists in diagnostics.ts
- [x] Record key migration constraints in Discoveries/Notes

---

### Step 1: Define v3 Schema
**Status:** 🟨 In Progress
- [ ] Add `ResilienceState` interface and `PersistedRepairRecord` interface with all fields from roadmap 3a
- [ ] Add `BatchDiagnostics` and `PersistedTaskExitSummary` interfaces for diagnostics section
- [ ] Add **required** `resilience: ResilienceState` and `diagnostics: BatchDiagnostics` to `PersistedBatchState` (required in v3; migration fills defaults for v1/v2)
- [ ] Add optional `exitDiagnostic?: TaskExitDiagnostic` to both `LaneTaskOutcome` (runtime) and `PersistedTaskRecord` (persisted) alongside legacy `exitReason`
- [ ] Bump `BATCH_STATE_SCHEMA_VERSION` to 3 and update version-history JSDoc
- [ ] Add v3 type contract table to STATUS.md Notes
- [ ] Verify types compile cleanly (no TS errors)

---

### Step 2: Implement Migration
**Status:** ⬜ Not Started
- [ ] Auto-detect schema version on read
- [ ] v1/v2 → v3 migration with conservative defaults
- [ ] Corrupt state handling (paused + diagnostic)
- [ ] Version mismatch error for old runtimes
- [ ] Unknown-field preservation on read/write roundtrip (ownership moved from Step 1 per R003)

---

### Step 3: Testing & Verification
**Status:** ⬜ Not Started
- [ ] v1 → v3 migration test
- [ ] v2 → v3 migration test
- [ ] v3 clean read test
- [ ] Unknown field preservation test
- [ ] Corrupt state test
- [ ] Full test suite passes

---

### Step 4: Documentation & Delivery
**Status:** ⬜ Not Started
- [ ] JSDoc for v3 schema
- [ ] `.DONE` created

---

## Reviews

| # | Type | Step | Verdict | File |
|---|------|------|---------|------|
| R001 | plan | Step 0 | REVISE | .reviews/R001-plan-step0.md |
| R002 | code | Step 0 | REVISE | .reviews/R002-code-step0.md |
| R003 | plan | Step 1 | REVISE | .reviews/R003-plan-step1.md |
| R003 | plan | Step 1 | REVISE | .reviews/R003-plan-step1.md |

## Discoveries

| Discovery | Disposition | Location |
|-----------|-------------|----------|
| `serializeBatchState()` rebuilds a strict `PersistedBatchState` object shape — unknown fields from loaded JSON will be dropped on roundtrip | Must fix in Step 2: merge unknown fields from loaded JSON into serialized output | `persistence.ts` serializeBatchState (~L847-873) |
| `analyzeOrchestratorStartupState()` recommends `cleanup-stale` for invalid/io-error state with no orphans — TP-030 requires `paused` with diagnostic instead of auto-delete for corrupt state | Must fix in Step 2: corrupt state → paused with diagnostic, never auto-delete | `persistence.ts` analyzeOrchestratorStartupState (~L1222-1229) |
| `validatePersistedState()` accepts v1 and v2, rejects anything else with STATE_SCHEMA_INVALID — must add v3 acceptance and v1/v2→v3 upconversion | Must update in Step 2 | `persistence.ts` validatePersistedState (~L550-700) |
| `BATCH_STATE_SCHEMA_VERSION = 2` in types.ts — must bump to 3 | Must update in Step 1 | `types.ts` (~L1113) |
| `TaskExitDiagnostic` confirmed in `diagnostics.ts` — has `classification`, `exitCode`, `errorMessage`, `tokensUsed`, `contextPct`, `partialProgressCommits`, `partialProgressBranch`, `durationSec`, `lastKnownStep`, `lastKnownCheckbox`, `repoId` | Dependency satisfied (TP-025) | `diagnostics.ts` (~L189) |
| `PersistedBatchState` interface needs new `resilience` and `diagnostics` sections — all optional for backward compat | Must add in Step 1 | `types.ts` PersistedBatchState interface |
| Test files: `orch-state-persistence.test.ts` exists; `state-migration.test.ts` to be created in Step 3 | Plan in Step 3 | `extensions/tests/` |

## Execution Log

| Timestamp | Action | Outcome |
|-----------|--------|---------|
| 2026-03-19 | Task staged | PROMPT.md and STATUS.md created |
| 2026-03-19 22:16 | Task started | Extension-driven execution |
| 2026-03-19 22:16 | Step 0 started | Preflight |
| 2026-03-19 22:17 | Review R001 | plan Step 0: REVISE |
| 2026-03-19 22:20 | Worker iter 1 | done in 198s, ctx: 47%, tools: 37 |
| 2026-03-19 22:21 | Review R002 | code Step 0: REVISE |
| 2026-03-19 22:22 | Worker iter 1 | done in 43s, ctx: 9%, tools: 8 |
| 2026-03-19 22:22 | Step 0 complete | Preflight |
| 2026-03-19 22:22 | Step 1 started | Define v3 Schema |
| 2026-03-19 22:23 | Worker iter 1 | done in 52s, ctx: 9%, tools: 10 |
| 2026-03-19 22:23 | Step 0 complete | Preflight |
| 2026-03-19 22:23 | Step 1 started | Define v3 Schema |
| 2026-03-19 22:24 | Review R003 | plan Step 1: REVISE |
| 2026-03-19 22:25 | Review R003 | plan Step 1: REVISE |

## Blockers

*None*

### Step 1/Step 2 Ownership Split (per R003 review)
- **Step 1 owns:** Type/schema contracts in `types.ts` only. All new v3 sections are optional on `PersistedBatchState` so v1/v2 states remain assignable. Reuses `TaskExitDiagnostic` from `diagnostics.ts`.
- **Step 2 owns:** Persistence/resume migration logic + unknown-field roundtrip preservation in `persistence.ts`.
- `exitReason` stays as legacy string. `exitDiagnostic` becomes preferred canonical data. Consumers should prefer `exitDiagnostic` when present.

## Notes

### Migration Matrix

| Concern | Current Behavior | Required v3 Behavior | Target File(s) |
|---------|-----------------|---------------------|----------------|
| Schema version | `BATCH_STATE_SCHEMA_VERSION = 2`, accepts v1+v2 | Bump to 3, accept v1+v2+v3 | `types.ts`, `persistence.ts` |
| Resilience fields | Not present | `resilience: { resumeForced, retryCountByScope, lastFailureClass, repairHistory[] }` | `types.ts` |
| Diagnostics fields | Not present | `diagnostics: { taskExits: Record<taskId, {classification,cost,durationSec,...}>, batchCost }` | `types.ts` |
| exitDiagnostic on task records | Not present | Optional `exitDiagnostic?: TaskExitDiagnostic` alongside legacy `exitReason` | `types.ts` |
| Unknown field preservation | `serializeBatchState()` constructs strict object — drops unknowns | Must merge unknown top-level keys from loaded state into serialized output | `persistence.ts` |
| Corrupt state handling | `analyzeOrchestratorStartupState()` → `cleanup-stale` (auto-delete) | Enter `paused` with diagnostic message, never auto-delete | `persistence.ts` |
| Old runtime on v3 state | Throws `STATE_SCHEMA_INVALID` with "Delete .pi/batch-state.json" | Change error message to include upgrade guidance | `persistence.ts` |
| v1→v3 migration | v1→v2 via `upconvertV1toV2()` | Chain: v1→v2→v3, with v3 defaults (empty resilience/diagnostics) | `persistence.ts` |
| v2→v3 migration | N/A | Default missing resilience/diagnostics fields conservatively | `persistence.ts` |
