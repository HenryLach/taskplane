# TP-030: State Schema v3 & Migration — Status

**Current Step:** Step 0: Preflight
**Status:** 🟡 In Progress
**Last Updated:** 2026-03-19
**Review Level:** 2
**Review Counter:** 2
**Iteration:** 1
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
**Status:** ⬜ Not Started
- [ ] Add resilience section
- [ ] Add diagnostics section
- [ ] Promote exitDiagnostic alongside legacy exitReason
- [ ] Preserve v2 fields, preserve unknown fields

---

### Step 2: Implement Migration
**Status:** ⬜ Not Started
- [ ] Auto-detect schema version on read
- [ ] v1/v2 → v3 migration with conservative defaults
- [ ] Corrupt state handling (paused + diagnostic)
- [ ] Version mismatch error for old runtimes

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
| R002 | code | Step 0 | REVISE | .reviews/R002-code-step0.md |

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
| 2026-03-19 22:22 | Review R002 | code Step 0: REVISE |

## Blockers

*None*

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
