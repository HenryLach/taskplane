# TP-020: Orch-Managed Branch Schema & Config — Status

**Current Step:** Step 4: Testing & Verification
**Status:** 🟡 In Progress
**Last Updated:** 2026-03-18
**Review Level:** 1
**Review Counter:** 5
**Iteration:** 5
**Size:** M

---

### Step 0: Preflight
**Status:** ✅ Complete

- [x] Read `types.ts` — locate runtime state, persisted state, config interfaces, defaults
- [x] Read `config-schema.ts` — understand config field definitions
- [x] Read `config-loader.ts` — understand camelCase↔snake_case mappings and legacy snake_case adapter
- [x] Read `settings-tui.ts` — understand TUI field declarations
- [x] Read `persistence.ts` — locate backward-compat defaults for new persisted fields, serialization/deserialization paths
- [x] Read `settings-tui.test.ts` — scan test coverage for section schema constraints, Advanced discoverability
- [x] Record preflight discoveries (file+line anchors) in STATUS.md Notes

---

### Step 1: Add `orchBranch` to Runtime + Persisted State
**Status:** ✅ Complete

- [x] Add `orchBranch: string` to `OrchBatchRuntimeState` and `PersistedBatchState` with JSDoc
- [x] Initialize to `""` in `freshOrchBatchState()`
- [x] Serialize `orchBranch` in `serializeBatchState()` (persistence.ts)
- [x] Default `orchBranch` to `""` in `validatePersistedState()` for backward compat (v2 files missing field)
- [x] Carry `orchBranch` from persisted state during resume reconstruction in `resume.ts`
- [x] Fix any PersistedBatchState object literal compile errors in tests

---

### Step 2: Add `integration` to Orchestrator Config
**Status:** ✅ Complete

- [x] Add `integration: "manual" | "auto"` to legacy `OrchestratorConfig.orchestrator` in `types.ts` + default `"manual"` in `DEFAULT_ORCHESTRATOR_CONFIG`
- [x] Add `integration: "manual" | "auto"` to unified `OrchestratorCoreConfig` in `config-schema.ts` + default `"manual"` in `DEFAULT_ORCHESTRATOR_SECTION`
- [x] Add `integration` mapping in `toOrchestratorConfig()` in `config-loader.ts`
- [x] Add test coverage: extend adapter assertions in `project-config-loader.test.ts` for `integration` (default, override, YAML mapping)

---

### Step 3: Add Integration Toggle to Settings TUI
**Status:** ✅ Complete

- [x] Add Integration field to Orchestrator section in `settings-tui.ts` with exact contract: configPath `orchestrator.orchestrator.integration`, label `Integration`, control `toggle`, layer `L1`, fieldType `enum`, values `["manual", "auto"]`, description per PROMPT.md
- [x] Verify field is editable L1 toggle and COVERED_PATHS auto-includes it (no manual edits needed)
- [x] Verify `integration` does NOT appear in Advanced section (covered by SECTIONS → COVERED_PATHS rebuild)

---

### Step 4: Testing & Verification
**Status:** ✅ Complete

- [x] Run `cd extensions && npx vitest run` — all tests must pass (zero failures) ✅ 21 files, 742 tests passed
- [x] Verify `freshOrchBatchState()` returns `orchBranch: ""` (inspect types.ts) ✅ line 916
- [x] Verify `DEFAULT_ORCHESTRATOR_CONFIG.orchestrator.integration === "manual"` (inspect types.ts) ✅ line 156
- [x] Verify backward-compat: `validatePersistedState()` defaults missing `orchBranch` to `""` for older v2 state files (inspect persistence.ts) ✅ lines 369-379 (validation + default) and line 791 (serialization)
- [x] Verify Settings TUI: `integration` field is editable L1 toggle in Orchestrator section and does NOT appear in Advanced section (confirm via settings-tui.test.ts coverage at tests 18.2, 18.8) ✅ settings-tui.ts line 105, tests 18.2+18.8 pass
- [x] Fix all failures if any, re-run tests until green ✅ No failures — 21 files, 742 tests all green

---

### Step 5: Documentation & Delivery
**Status:** ⬜ Not Started

- [ ] Discoveries logged
- [ ] `.DONE` created

---

## Reviews

| # | Type | Step | Verdict | File |
| R001 | plan | Step 0 | REVISE | .reviews/R001-plan-step0.md |
| R001 | plan | Step 0 | APPROVE | .reviews/R001-plan-step0.md |
| R002 | plan | Step 1 | REVISE | .reviews/R002-plan-step1.md |
| R002 | plan | Step 1 | REVISE | .reviews/R002-plan-step1.md |
| R003 | plan | Step 2 | REVISE | .reviews/R003-plan-step2.md |
| R003 | plan | Step 2 | APPROVE | .reviews/R003-plan-step2.md |
| R004 | plan | Step 3 | REVISE | .reviews/R004-plan-step3.md |
| R004 | plan | Step 3 | REVISE | .reviews/R004-plan-step3.md |
| R005 | plan | Step 4 | REVISE | .reviews/R005-plan-step4.md |
| R005 | plan | Step 4 | REVISE | .reviews/R005-plan-step4.md |
|---|------|------|---------|------|

---

## Discoveries

| Discovery | Disposition | Location |
|-----------|-------------|----------|

---

## Execution Log

| Timestamp | Action | Outcome |
|-----------|--------|---------|
| 2026-03-18 | Task staged | PROMPT.md and STATUS.md created |
| 2026-03-18 03:23 | Task started | Extension-driven execution |
| 2026-03-18 03:23 | Step 0 started | Preflight |
| 2026-03-18 03:23 | Task started | Extension-driven execution |
| 2026-03-18 03:23 | Step 0 started | Preflight |
| 2026-03-18 03:24 | Review R001 | plan Step 0: REVISE |
| 2026-03-18 03:26 | Review R001 | plan Step 0: APPROVE |
| 2026-03-18 03:28 | Worker iter 1 | done in 228s, ctx: 40%, tools: 32 |
| 2026-03-18 03:28 | Step 0 complete | Preflight |
| 2026-03-18 03:28 | Step 1 started | Add `orchBranch` to Runtime + Persisted State |
| 2026-03-18 03:28 | Worker iter 1 | done in 160s, ctx: 44%, tools: 26 |
| 2026-03-18 03:28 | Step 0 complete | Preflight |
| 2026-03-18 03:28 | Step 1 started | Add `orchBranch` to Runtime + Persisted State |
| 2026-03-18 03:31 | Review R002 | plan Step 1: REVISE |
| 2026-03-18 03:31 | Review R002 | plan Step 1: REVISE |
| 2026-03-18 03:37 | Worker iter 2 | done in 367s, ctx: 21%, tools: 65 |
| 2026-03-18 03:37 | Step 1 complete | Add `orchBranch` to Runtime + Persisted State |
| 2026-03-18 03:37 | Step 2 started | Add `integration` to Orchestrator Config |
| 2026-03-18 03:39 | Review R003 | plan Step 2: REVISE |
| 2026-03-18 03:40 | Review R003 | plan Step 2: APPROVE |
| 2026-03-18 03:43 | Worker iter 3 | done in 141s, ctx: 26%, tools: 28 |
| 2026-03-18 03:43 | Step 2 complete | Add `integration` to Orchestrator Config |
| 2026-03-18 03:43 | Step 3 started | Add Integration Toggle to Settings TUI |
| 2026-03-18 03:43 | Worker iter 3 | done in 269s, ctx: 18%, tools: 43 |
| 2026-03-18 03:43 | Step 2 complete | Add `integration` to Orchestrator Config |
| 2026-03-18 03:43 | Step 3 started | Add Integration Toggle to Settings TUI |
| 2026-03-18 03:44 | Review R004 | plan Step 3: REVISE |
| 2026-03-18 03:45 | Review R004 | plan Step 3: REVISE |
| 2026-03-18 03:46 | Worker iter 4 | done in 92s, ctx: 20%, tools: 17 |
| 2026-03-18 03:46 | Step 3 complete | Add Integration Toggle to Settings TUI |
| 2026-03-18 03:46 | Step 4 started | Testing & Verification |
| 2026-03-18 03:46 | Worker iter 4 | done in 66s, ctx: 12%, tools: 15 |
| 2026-03-18 03:46 | Step 3 complete | Add Integration Toggle to Settings TUI |
| 2026-03-18 03:46 | Step 4 started | Testing & Verification |
| 2026-03-18 03:47 | Review R005 | plan Step 4: REVISE |
| 2026-03-18 03:49 | Review R005 | plan Step 4: REVISE |

---

## Blockers

*None*

---

## Notes

### Preflight Discoveries (file+line anchors)

**types.ts:**
- `OrchBatchRuntimeState` — ~line 530. Add `orchBranch: string` after `baseBranch`.
- `PersistedBatchState` — ~line 900. Add `orchBranch: string` after `baseBranch`.
- `freshOrchBatchState()` — ~line 565. Add `orchBranch: ""` after `baseBranch: ""`.
- `OrchestratorConfig` (legacy snake_case) — ~line 11. Add `integration: "manual" | "auto"` to `orchestrator` sub-object.
- `DEFAULT_ORCHESTRATOR_CONFIG` — ~line 133. Add `integration: "manual"` to `orchestrator` sub-object.

**config-schema.ts:**
- `OrchestratorCoreConfig` — ~line 195. Add `integration: "manual" | "auto"` field.
- `DEFAULT_ORCHESTRATOR_SECTION` — ~line 360. Add `integration: "manual"` to `orchestrator` sub-object.

**config-loader.ts:**
- `toOrchestratorConfig()` — ~line 430. Add `integration: o.orchestrator.integration` mapping.
- `mapOrchestratorYaml()` uses `convertStructuralKeys()` for `orchestrator` section — `integration` has no underscore, auto-maps to itself. No special handling needed.

**persistence.ts:**
- `serializeBatchState()` — ~line 796. Add `orchBranch: state.orchBranch` to the persisted object assembly.
- `validatePersistedState()` — ~line 370. Add optional `orchBranch` string validation like `baseBranch` pattern. Default to `""` if missing (backward compat).
- No schema version bump needed — `orchBranch` is an optional string field within v2, defaults to `""` when absent.

**settings-tui.ts:**
- `SECTIONS[0]` (Orchestrator) — ~line 100. Add Integration toggle field after `operatorId`.
- `COVERED_PATHS` is auto-built from `SECTIONS` fields, so adding the field definition is sufficient.

**settings-tui.test.ts:**
- Test 12.3 (~line 531): validates all editable sections have ≥1 field — passes automatically.
- Test 18.2 (~line 1423): validates editable fields NOT in Advanced. New `integration` field will be editable, so covered automatically.
- Test 18.8 (~line 1509): every editable section field excluded from Advanced — auto-covered by COVERED_PATHS rebuild.
- Key concern: tests that snapshot exact field counts or section sizes may break if hardcoded.
